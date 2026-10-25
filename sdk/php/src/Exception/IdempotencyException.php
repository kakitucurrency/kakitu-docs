<?php

declare(strict_types=1);

namespace Kakitu\Exception;

/** An Idempotency-Key conflict (idempotency_key_reuse, _in_progress, _acted) or the store being unavailable. */
class IdempotencyException extends KakituException
{
}
