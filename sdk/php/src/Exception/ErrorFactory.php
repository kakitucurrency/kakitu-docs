<?php

declare(strict_types=1);

namespace Kakitu\Exception;

use Kakitu\ErrorCode;

/** Turns an error response into the right typed exception. */
final class ErrorFactory
{
    /**
     * Understands both shapes the server speaks:
     *  - /v1 envelope:      {"error":{"code":"...","message":"...","request_id":"..."}}
     *  - auth middleware:   {"error":"unauthorized","reason":"bad_signature"}   (a plain string!)
     *
     * @param array<string,string> $headers lowercase header names
     */
    public static function fromResponse(int $status, string $body, array $headers): KakituException
    {
        $data = json_decode($body, true);
        $requestId = $headers['x-request-id'] ?? null;
        $reason = null;
        $code = null;
        $message = null;

        if (is_array($data) && isset($data['error'])) {
            $err = $data['error'];
            if (is_array($err)) {
                $code = is_string($err['code'] ?? null) ? $err['code'] : null;
                $message = is_string($err['message'] ?? null) ? $err['message'] : null;
                $requestId = is_string($err['request_id'] ?? null) && $err['request_id'] !== '' ? $err['request_id'] : $requestId;
            } elseif (is_string($err)) {
                $code = $err;
                $reason = is_string($data['reason'] ?? null) ? $data['reason'] : null;
                $message = self::authMessage($reason);
            }
        }
        if ($code === null) {
            $code = $status === 401 ? ErrorCode::UNAUTHORIZED : ErrorCode::INTERNAL;
            $message ??= "Unexpected HTTP $status response from Kakitu.";
        }
        $message ??= "Kakitu returned HTTP $status ($code).";

        $class = match ($code) {
            ErrorCode::UNAUTHORIZED => AuthenticationException::class,
            ErrorCode::INVALID_REQUEST, ErrorCode::IDEMPOTENCY_KEY_REQUIRED, ErrorCode::IDEMPOTENCY_KEY_INVALID,
            ErrorCode::AMOUNT_BELOW_MINIMUM, ErrorCode::AMOUNT_ABOVE_MAXIMUM, ErrorCode::REQUEST_TOO_LARGE => InvalidRequestException::class,
            ErrorCode::MERCHANT_NOT_REGISTERED, ErrorCode::MERCHANT_NOT_APPROVED, ErrorCode::MERCHANT_SUSPENDED,
            ErrorCode::MERCHANT_NAME_FROZEN,
            // Payouts are off for you. Which switch — the global one or yours — is deliberately
            // not published, so there is nothing more specific to raise.
            ErrorCode::PAYOUTS_DISABLED => MerchantException::class,
            ErrorCode::IDEMPOTENCY_KEY_REUSE, ErrorCode::IDEMPOTENCY_KEY_IN_PROGRESS, ErrorCode::IDEMPOTENCY_KEY_ACTED,
            ErrorCode::IDEMPOTENCY_UNAVAILABLE => IdempotencyException::class,
            // PAYOUT_DAILY_CAP_EXCEEDED is a 429 like the others, but it is its OWN budget on
            // its own counter: raising the collection cap does nothing for it. Only `errorCode`
            // tells them apart, which is why you switch on that and never on the message.
            ErrorCode::RATE_LIMITED, ErrorCode::DAILY_CAP_EXCEEDED, ErrorCode::PAYER_VELOCITY_EXCEEDED,
            ErrorCode::PAYOUT_DAILY_CAP_EXCEEDED => RateLimitException::class,
            // 400, not 429: waiting does not help, a smaller payout does.
            ErrorCode::PAYOUT_AMOUNT_ABOVE_MAXIMUM => InvalidRequestException::class,
            // A payout quote that is missing, expired, already spent or somebody else's is ONE
            // answer with one set of words, on purpose.
            ErrorCode::CHARGE_NOT_FOUND, ErrorCode::ORDER_NOT_FOUND, ErrorCode::EVENT_NOT_FOUND,
            ErrorCode::PAYOUT_NOT_FOUND, ErrorCode::PAYOUT_QUOTE_NOT_FOUND => NotFoundException::class,
            ErrorCode::REFERENCE_REUSED, ErrorCode::PROFILE_REQUIRED => ConflictException::class,
            default => ApiException::class,
        };

        return new $class($code, $message, $requestId, $status, $reason);
    }

    private static function authMessage(?string $reason): string
    {
        return match ($reason) {
            'timestamp_out_of_range' => 'Your server clock is more than 120 seconds away from Kakitu\'s. Sync it (NTP) and retry.',
            'replay' => 'An identical signed request was already received in this window (replay refused).',
            'bad_signature' => 'The signature does not match the X-Kakitu-Address. Check the private key.',
            'missing_auth_headers' => 'One of the X-Kakitu-* authentication headers is missing.',
            'bad_timestamp' => 'X-Kakitu-Timestamp must be unix seconds.',
            null => 'The request was not authenticated.',
            default => 'The request was not authenticated (' . $reason . ').',
        };
    }
}
