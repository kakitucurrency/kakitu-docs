<?php

declare(strict_types=1);

namespace Kakitu\Exception;

/** Server-side or unrecognised failure (internal, rail_unavailable, unknown codes, malformed responses). */
class ApiException extends KakituException
{
}
