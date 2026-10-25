<?php

declare(strict_types=1);

namespace Kakitu\Exception;

/** The request signature was refused (code unauthorized). See $reason. */
class AuthenticationException extends KakituException
{
}
