<?php

declare(strict_types=1);

namespace Kakitu\Exception;

/** The network call failed (DNS, TLS, timeout). The request may or may not have reached Kakitu: retry with the SAME idempotency key. */
class ConnectionException extends KakituException
{
}
