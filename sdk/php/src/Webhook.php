<?php

declare(strict_types=1);

namespace Kakitu;

use Kakitu\Exception\SignatureVerificationException;

/**
 * Verifies that a webhook really came from Kakitu.
 *
 * The scheme is the server's own (webhookout.Sign). The `Kakitu-Signature` header carries
 *
 *     t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>" keyed with your webhook secret>
 *
 * The timestamp is INSIDE the signed string, not merely alongside it, so a replayer cannot shift
 * the clock without breaking the signature.
 *
 * Pass the RAW body. Re-encoding the JSON first reorders keys and changes whitespace, and you
 * would then verify a different string than the one that was signed.
 *
 * Delivery is AT-LEAST-ONCE: the `Kakitu-Event-Id` header (and `id` in the payload) is stable
 * across every attempt and across a replay, and it is your dedupe key. A receiver that keys on
 * it sees exactly-once; one that does not will double-count.
 *
 *     $event = Webhook::constructEvent(
 *         file_get_contents('php://input'),          // the RAW body, not re-encoded JSON
 *         $_SERVER['HTTP_KAKITU_SIGNATURE'] ?? '',
 *         getenv('KAKITU_WEBHOOK_SECRET'),
 *     );
 */
final class Webhook
{
    public const DEFAULT_TOLERANCE = 300;

    /** Signature header value for a payload; mostly for tests and local simulation. */
    public static function sign(#[\SensitiveParameter] string $secret, int $timestamp, string $payload): string
    {
        return 't=' . $timestamp . ',v1=' . hash_hmac('sha256', $timestamp . '.' . $payload, $secret);
    }

    /** True only if the signature is valid and the timestamp is within $tolerance seconds. */
    public static function verify(string $payload, string $header, #[\SensitiveParameter] string $secret, int $tolerance = self::DEFAULT_TOLERANCE, ?int $now = null): bool
    {
        try {
            self::assertValid($payload, $header, $secret, $tolerance, $now);
            return true;
        } catch (SignatureVerificationException) {
            return false;
        }
    }

    /**
     * Verify, then decode the event.
     *
     * @return array<string,mixed>
     * @throws SignatureVerificationException
     */
    public static function constructEvent(string $payload, string $header, #[\SensitiveParameter] string $secret, int $tolerance = self::DEFAULT_TOLERANCE, ?int $now = null): array
    {
        self::assertValid($payload, $header, $secret, $tolerance, $now);
        $event = json_decode($payload, true);
        if (!is_array($event)) {
            throw self::fail('The webhook payload is not valid JSON.');
        }
        return $event;
    }

    private static function assertValid(string $payload, string $header, string $secret, int $tolerance, ?int $now): void
    {
        if ($secret === '') {
            throw self::fail('No webhook secret configured.');
        }
        $timestamp = null;
        $candidates = [];
        foreach (explode(',', $header) as $part) {
            $kv = explode('=', trim($part), 2);
            if (count($kv) !== 2) {
                continue;
            }
            if ($kv[0] === 't' && ctype_digit($kv[1])) {
                $timestamp = (int) $kv[1];
            } elseif ($kv[0] === 'v1') {
                $candidates[] = strtolower($kv[1]);
            }
        }
        if ($timestamp === null || $candidates === []) {
            throw self::fail('The signature header is missing or malformed.');
        }
        $expected = hash_hmac('sha256', $timestamp . '.' . $payload, $secret);
        $ok = false;
        foreach ($candidates as $c) {
            $ok = hash_equals($expected, $c) || $ok; // no early exit: constant time per candidate
        }
        if (!$ok) {
            throw self::fail('The signature does not match the payload.');
        }
        if (abs(($now ?? time()) - $timestamp) > $tolerance) {
            throw self::fail('The webhook timestamp is outside the tolerance window (possible replay).');
        }
    }

    private static function fail(string $msg): SignatureVerificationException
    {
        return new SignatureVerificationException(ErrorCode::WEBHOOK_SIGNATURE_INVALID, $msg);
    }
}
