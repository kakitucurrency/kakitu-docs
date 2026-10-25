<?php

declare(strict_types=1);

namespace Kakitu\Exception;

/** The request was malformed or out of bounds (invalid_request, idempotency_key_required/invalid, amount_below/above_maximum, request_too_large). */
class InvalidRequestException extends KakituException
{
}
