<?php

declare(strict_types=1);

namespace Kakitu\Exception;

/** Throttled or capped (rate_limited, daily_cap_exceeded, payer_velocity_exceeded). Only rate_limited is retried automatically. */
class RateLimitException extends KakituException
{
}
