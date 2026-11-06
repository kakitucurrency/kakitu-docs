<?php

declare(strict_types=1);

namespace Kakitu\Resources;

use InvalidArgumentException;

/**
 * Where a payout goes and who is being paid. Build one with the constructor for its type:
 *
 *     Beneficiary::phone('254712345678', 'Jane Wanjiru')
 *     Beneficiary::till('123456', 'Jane Stores')
 *     Beneficiary::paybill('400200', 'INV-77', 'Landlord Ltd')
 *     Beneficiary::bank('0123456789', '01', 'Jane Wanjiru')
 *
 * Exactly the fields of one type may be given: a till with a phone beside it is refused here, as
 * the server would refuse it. `name` is the person being PAID and is never taken from your own
 * profile. A phone beneficiary has no `type` on the wire, so a phone payout looks as it always did.
 */
final class Beneficiary
{
    public const PHONE = 'phone';
    public const TILL = 'till';
    public const PAYBILL = 'paybill';
    public const BANK = 'bank';

    private const FIELDS = [
        self::PHONE => ['phone'],
        self::TILL => ['till'],
        self::PAYBILL => ['paybill', 'account'],
        self::BANK => ['account', 'bank_code'],
    ];

    /** @var array<string,string> */
    private array $fields;

    /** @param array<string,string> $fields */
    public function __construct(public readonly string $type, public readonly string $name, array $fields)
    {
        if (!isset(self::FIELDS[$type])) {
            throw new InvalidArgumentException("A beneficiary type is one of phone, till, paybill or bank, not '$type'.");
        }
        foreach (self::FIELDS[$type] as $f) {
            if (!isset($fields[$f]) || $fields[$f] === '') {
                throw new InvalidArgumentException("A $type beneficiary needs '$f'.");
            }
        }
        foreach (array_keys($fields) as $f) {
            if (!in_array($f, self::FIELDS[$type], true)) {
                throw new InvalidArgumentException("A $type beneficiary has no '$f'.");
            }
        }
        if ($name === '') {
            throw new InvalidArgumentException('A beneficiary needs the name of the person being paid.');
        }
        $this->fields = $fields;
    }

    public static function phone(string $phone, string $name): self
    {
        return new self(self::PHONE, $name, ['phone' => $phone]);
    }

    public static function till(string $till, string $name): self
    {
        return new self(self::TILL, $name, ['till' => $till]);
    }

    public static function paybill(string $paybill, string $account, string $name): self
    {
        return new self(self::PAYBILL, $name, ['paybill' => $paybill, 'account' => $account]);
    }

    public static function bank(string $account, string $bankCode, string $name): self
    {
        return new self(self::BANK, $name, ['account' => $account, 'bank_code' => $bankCode]);
    }

    /**
     * The place alone, as payoutDestinations->save() takes it. A phone carries no type.
     *
     * @return array<string,string>
     */
    public function destination(): array
    {
        $d = $this->type === self::PHONE ? [] : ['type' => $this->type];
        foreach (self::FIELDS[$this->type] as $f) {
            $d[$f] = $this->fields[$f];
        }
        return $d;
    }

    /**
     * The wire form, for the `beneficiary` of a quote or a request.
     *
     * @return array<string,string>
     */
    public function toArray(): array
    {
        return $this->destination() + ['name' => $this->name];
    }

    /** A number and a name are not for a log. */
    public function __debugInfo(): array
    {
        return ['type' => $this->type];
    }
}
