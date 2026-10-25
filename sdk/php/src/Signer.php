<?php

declare(strict_types=1);

namespace Kakitu;

use Elliptic\EC;
use InvalidArgumentException;
use kornrunner\Keccak;

/**
 * Produces the three X-Kakitu-* authentication headers for a request.
 *
 * The signed message is exactly (see auth/wallet.go in the server):
 *
 *     "{METHOD} {path}{?query} {timestamp} {sha256hex(body)}"
 *
 * signed with EIP-191 personal_sign using secp256k1. You never call this yourself: the client
 * does it for every request. It is public so the signing logic can be tested and audited.
 *
 * The private key is held privately and is deliberately invisible to var_dump(), print_r(),
 * serialize() and exception traces: it can only leave this object through the signature maths.
 */
final class Signer
{
    public const HEADER_ADDRESS = 'X-Kakitu-Address';
    public const HEADER_TIMESTAMP = 'X-Kakitu-Timestamp';
    public const HEADER_SIGNATURE = 'X-Kakitu-Signature';

    private const CURVE_ORDER_HEX = 'fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141';

    private string $privateKeyHex;
    private string $address;
    /** @var callable(): int */
    private $clock;
    /** @var array<string,int> fingerprint of a signed request => timestamp it was signed with */
    private array $recent = [];

    /**
     * @param string        $privateKey 64 hex characters, with or without a 0x prefix
     * @param callable|null $clock      returns unix seconds; injectable for tests
     */
    public function __construct(#[\SensitiveParameter] string $privateKey, ?callable $clock = null)
    {
        $hex = strtolower(str_starts_with($privateKey, '0x') || str_starts_with($privateKey, '0X') ? substr($privateKey, 2) : $privateKey);
        if (!preg_match('/^[0-9a-f]{64}$/', $hex)) {
            // Never echo the value: a malformed key is still most of a key.
            throw new InvalidArgumentException('private_key must be 64 hexadecimal characters (optionally prefixed with 0x).');
        }
        // Valid range is 1 .. n-1 (n = the secp256k1 group order). Compared as same-length hex.
        if ($hex === str_repeat('0', 64) || strcmp($hex, self::CURVE_ORDER_HEX) >= 0) {
            throw new InvalidArgumentException('private_key is not a valid secp256k1 key.');
        }
        $key = (new EC('secp256k1'))->keyFromPrivate($hex, 'hex');
        $this->privateKeyHex = $hex;
        $this->address = self::toChecksumAddress(
            substr(Keccak::hash(hex2bin(substr($key->getPublic(false, 'hex'), 2)), 256), 24)
        );
        $this->clock = $clock ?? static fn (): int => time();
    }

    /** The EIP-55 wallet address this key signs for. This is your merchant identity. */
    public function address(): string
    {
        return $this->address;
    }

    /** Lowercase hex sha256 of the raw body (of the empty string when there is none). */
    public static function bodyHash(string $body): string
    {
        return hash('sha256', $body);
    }

    /**
     * The exact string that is signed.
     *
     * @param string $pathAndQuery path, plus "?" and the raw query exactly as sent ONLY if non-empty
     */
    public static function message(string $method, string $pathAndQuery, int|string $timestamp, string $body): string
    {
        return strtoupper($method) . ' ' . $pathAndQuery . ' ' . $timestamp . ' ' . self::bodyHash($body);
    }

    /** EIP-191 personal_sign over $message. Returns 0x + 65 bytes (r || s || v), v = 27/28. */
    public function personalSign(string $message): string
    {
        $prefixed = "\x19Ethereum Signed Message:\n" . strlen($message) . $message;
        $digest = Keccak::hash($prefixed, 256);

        $ec = new EC('secp256k1');
        $sig = $ec->keyFromPrivate($this->privateKeyHex, 'hex')->sign($digest, 'hex', ['canonical' => true]);

        return '0x' . $sig->r->toString(16, 64) . $sig->s->toString(16, 64) . dechex(27 + $sig->recoveryParam);
    }

    /**
     * Headers for one request. Call once per ATTEMPT: a retry must be signed afresh.
     *
     * The server rejects a request identical to an earlier one (same wallet, method, path, query,
     * body and second) as a replay. A retry inside the same second would be exactly that, so if
     * this signer already signed this very request at the current second it moves the timestamp
     * on by one second (the server tolerates 120 seconds of skew).
     *
     * @return array<string,string> header name => value
     */
    public function headers(string $method, string $pathAndQuery, string $body = ''): array
    {
        $now = ($this->clock)();
        $fingerprint = hash('sha256', strtoupper($method) . "\0" . $pathAndQuery . "\0" . $body);
        foreach ($this->recent as $fp => $ts) {
            if ($ts < $now - 300) {
                unset($this->recent[$fp]);
            }
        }
        $ts = $now;
        if (isset($this->recent[$fingerprint]) && $this->recent[$fingerprint] >= $ts) {
            $ts = $this->recent[$fingerprint] + 1;
        }
        $this->recent[$fingerprint] = $ts;

        return [
            self::HEADER_ADDRESS => $this->address,
            self::HEADER_TIMESTAMP => (string) $ts,
            self::HEADER_SIGNATURE => $this->personalSign(self::message($method, $pathAndQuery, $ts, $body)),
        ];
    }

    /** Keeps the key out of var_dump / print_r / var_export-by-debugger output. */
    public function __debugInfo(): array
    {
        return ['address' => $this->address];
    }

    public function __serialize(): array
    {
        throw new \LogicException('A Signer holds a private key and cannot be serialized.');
    }

    public function __clone()
    {
        throw new \LogicException('A Signer holds a private key and cannot be cloned.');
    }

    private static function toChecksumAddress(string $hex40): string
    {
        $hash = Keccak::hash($hex40, 256);
        $out = '0x';
        for ($i = 0; $i < 40; $i++) {
            $out .= (ctype_alpha($hex40[$i]) && hexdec($hash[$i]) >= 8) ? strtoupper($hex40[$i]) : $hex40[$i];
        }
        return $out;
    }
}
