<?php

declare(strict_types=1);

namespace Kakitu\Resources;

use InvalidArgumentException;
use Kakitu\Kakitu;

/**
 * Gasless KSHS transfers (POST /v1/transfers).
 *
 * THIS SDK DOES NOT SIGN THE TRANSFER, AND CANNOT.
 *
 * Two signatures are required and YOU produce both, with your own wallet key:
 *
 *   v / r / s     an EIP-2612 permit, signed under the TOKEN's EIP-712 domain
 *   iv / ir / is  an EIP-712 Relay(owner,to,value,deadline,nonce) intent, signed under the
 *                 FORWARDER's domain
 *
 * Kakitu holds no keys, signs nothing on your behalf and never decides who pays whom; it only
 * pays the gas. The X-Kakitu-Signature this SDK puts on every request authenticates you to the
 * API and authorises nothing on chain — the two are unrelated, and confusing them is the single
 * most common mistake on this API.
 */
final class Transfers
{
    public function __construct(private Kakitu $client)
    {
    }

    /**
     * Relay a transfer you have already signed.
     *
     * $transfer must carry exactly: from (YOUR OWN wallet address — the server refuses a
     * transfer whose `from` is not the authenticated caller), to, value_wei, deadline (unix
     * seconds, in the future), v, r, s, iv, ir, is.
     *
     * value_wei is a STRING and must stay one. Through a PHP float, 1000000000000000000000
     * becomes 1.0E+21 and the signature will not verify — this method refuses a non-string
     * rather than let that reach the wire.
     *
     * An Idempotency-Key is REQUIRED on this route and one is generated unless you pass your
     * own in $options['idempotency_key'].
     *
     * On success: `{"id": "<transaction hash>", "status": "pending"|"confirmed"}`.
     *
     * @param array{from: string, to: string, value_wei: string, deadline: int, v: int, r: string, s: string, iv: int, ir: string, is: string} $transfer
     * @param array{idempotency_key?: string} $options
     * @return array<string,mixed>
     */
    public function create(array $transfer, array $options = []): array
    {
        self::assertSignedTransfer($transfer);
        return $this->client->request('POST', '/v1/transfers', [], $transfer, $options + ['idempotent' => true]);
    }

    /**
     * Checks the shape of a caller-signed transfer before it costs a round trip.
     *
     * It verifies nothing cryptographic — it cannot, the signatures are over on-chain data this
     * SDK never sees. It only catches the two mistakes that produce an unreadable chain-level
     * rejection: a missing half of a signature pair, and a value_wei that has been through a
     * float.
     *
     * @param array<string,mixed> $t
     */
    public static function assertSignedTransfer(array $t): void
    {
        foreach (['from', 'to', 'value_wei', 'deadline', 'v', 'r', 's', 'iv', 'ir', 'is'] as $k) {
            if (!isset($t[$k]) || $t[$k] === '') {
                throw new InvalidArgumentException(
                    "The signed transfer is missing '$k'. It needs from, to, value_wei, deadline, "
                    . 'the EIP-2612 permit (v, r, s) and the EIP-712 Relay intent (iv, ir, is). '
                    . 'You sign both with your own wallet key; this SDK does not sign them.'
                );
            }
        }
        if (!is_string($t['value_wei'])) {
            throw new InvalidArgumentException(
                "'value_wei' must be a decimal STRING, not a number: a float loses the exact "
                . 'value and the signature will then not verify.'
            );
        }
    }
}
