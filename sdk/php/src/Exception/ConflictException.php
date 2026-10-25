<?php

declare(strict_types=1);

namespace Kakitu\Exception;

/** reference_reused: this merchant already has a charge with that reference. */
class ConflictException extends KakituException
{
}
