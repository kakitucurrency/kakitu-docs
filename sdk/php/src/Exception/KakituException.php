<?php

declare(strict_types=1);

namespace Kakitu\Exception;

use RuntimeException;

/**
 * Base of every error this SDK throws. Switch on {@see $errorCode} (compare with
 * {@see \Kakitu\ErrorCode}) or on the subclass; never match the message text.
 *
 * (PHP's built-in getCode() is a final int, so the API's string code lives in $errorCode.)
 */
class KakituException extends RuntimeException
{
    public function __construct(
        public readonly string $errorCode,
        string $message,
        public readonly ?string $requestId = null,
        public readonly int $httpStatus = 0,
        /** Only set for authentication failures: the server's short reason, e.g. "replay", "bad_signature", "timestamp_out_of_range". */
        public readonly ?string $reason = null,
        ?\Throwable $previous = null,
    ) {
        parent::__construct($message, 0, $previous);
    }

    public function getErrorCode(): string
    {
        return $this->errorCode;
    }

    public function getRequestId(): ?string
    {
        return $this->requestId;
    }

    public function getHttpStatus(): int
    {
        return $this->httpStatus;
    }
}
