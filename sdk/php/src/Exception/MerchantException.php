<?php

declare(strict_types=1);

namespace Kakitu\Exception;

/** The merchant account is not usable for this call (merchant_not_registered, merchant_not_approved, merchant_suspended, merchant_name_frozen). */
class MerchantException extends KakituException
{
}
