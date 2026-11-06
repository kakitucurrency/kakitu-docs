<?php

declare(strict_types=1);

namespace Kakitu\Tests;

use InvalidArgumentException;
use Kakitu\ErrorCode;
use Kakitu\Exception;
use Kakitu\EventType;
use Kakitu\Kakitu;
use Kakitu\PayoutState;
use Kakitu\Resources\Beneficiary;
use PHPUnit\Framework\TestCase;

/**
 * What the developer pitch added, as the SDK carries it: a payment reference, typed payout
 * destinations, approve-first requests, saved destinations and the lock, and the event types that
 * announce them. Shapes are the server's (controller/v1_payout_c.go, v1_payout_destinations_c.go,
 * repository/payout_event.go, transfer_notify.go).
 */
final class DevPitchTest extends TestCase
{
    private const KEY = '0x1ab42cc412b618bdea3a599e3c9bae199ebf030895b039e9db1e30dafb12b727';

    private const SIGNED = [
        'from' => '0xMe', 'to' => '0xYou', 'value_wei' => '1000000000000000000000', 'deadline' => 1758240600,
        'v' => 27, 'r' => '0x1111111111111111111111111111111111111111111111111111111111111111',
        's' => '0x2222222222222222222222222222222222222222222222222222222222222222', 'iv' => 28,
        'ir' => '0x3333333333333333333333333333333333333333333333333333333333333333',
        'is' => '0x4444444444444444444444444444444444444444444444444444444444444444',
    ];

    private function client(FakeTransport $t): Kakitu
    {
        return new Kakitu([
            'private_key' => self::KEY, 'transport' => $t,
            'clock' => static fn (): int => 1758240000, 'sleeper' => static function (float $s): void {},
        ]);
    }

    /** @return array<string,mixed> */
    private function sent(FakeTransport $t, int $i): array
    {
        return json_decode((string) $t->requests[$i]['body'], true);
    }

    public function testAReferenceRidesOnTheTransferAndIsAbsentWithoutOne(): void
    {
        $t = new FakeTransport();
        $k = $this->client($t);
        $k->transfers->create(self::SIGNED + ['reference' => 'ORD-1042']);
        $k->transfers->create(self::SIGNED);
        $this->assertSame('ORD-1042', $this->sent($t, 0)['reference']);
        $this->assertArrayNotHasKey('reference', $this->sent($t, 1));
    }

    /** @return iterable<string, array{Beneficiary, array<string,string>}> */
    public static function beneficiaries(): iterable
    {
        yield 'phone' => [Beneficiary::phone('254712345678', 'Jane'), ['phone' => '254712345678', 'name' => 'Jane']];
        yield 'till' => [Beneficiary::till('123456', 'Jane Stores'), ['type' => 'till', 'till' => '123456', 'name' => 'Jane Stores']];
        yield 'paybill' => [Beneficiary::paybill('400200', 'INV-77', 'Landlord'),
            ['type' => 'paybill', 'paybill' => '400200', 'account' => 'INV-77', 'name' => 'Landlord']];
        yield 'bank' => [Beneficiary::bank('0123456789', '01', 'Jane'),
            ['type' => 'bank', 'account' => '0123456789', 'bank_code' => '01', 'name' => 'Jane']];
    }

    /** @param array<string,string> $wire */
    #[\PHPUnit\Framework\Attributes\DataProvider('beneficiaries')]
    public function testEachBeneficiaryTypeGoesOnTheWireWithOnlyItsOwnFields(Beneficiary $b, array $wire): void
    {
        $t = new FakeTransport();
        $this->client($t)->payouts->quote(['amount_kes' => 1000, 'beneficiary' => $b->toArray()]);
        $this->assertSame($wire, $this->sent($t, 0)['beneficiary']);
    }

    public function testABeneficiaryRefusesAFieldThatIsNotItsOwnAndAMissingOne(): void
    {
        $this->expectException(InvalidArgumentException::class);
        new Beneficiary('till', 'x', ['till' => '123456', 'phone' => '254712345678']);
    }

    public function testATillWithoutANumberIsRefused(): void
    {
        $this->expectException(InvalidArgumentException::class);
        new Beneficiary('till', 'x', []);
    }

    public function testARequestGoesToRequestsWithAGeneratedKeyAndTheDestinationsSendNone(): void
    {
        $t = new FakeTransport();
        $k = $this->client($t);
        $k->payouts->request(['amount_kes' => 9000, 'beneficiary' => Beneficiary::phone('254712345678', 'J W')->toArray()]);
        $k->payoutDestinations->list();
        $k->payoutDestinations->save(Beneficiary::till('123456', 'ignored')->destination());
        $k->payoutDestinations->remove('d-1');
        $k->payoutDestinations->setLock(true);

        $this->assertSame(
            [['POST', '/v1/payouts/requests'], ['GET', '/v1/payout-destinations'], ['POST', '/v1/payout-destinations'],
                ['DELETE', '/v1/payout-destinations/d-1'], ['POST', '/v1/payout-destinations/lock']],
            array_map(static fn (array $r): array => [$r['method'], parse_url($r['url'], PHP_URL_PATH)], $t->requests),
        );
        $this->assertArrayHasKey('Idempotency-Key', $t->requests[0]['headers']);
        foreach (array_slice($t->requests, 1) as $r) {
            $this->assertArrayNotHasKey('Idempotency-Key', $r['headers']);
        }
        $this->assertSame(['type' => 'till', 'till' => '123456'], $this->sent($t, 2));
        $this->assertSame(['locked' => true], $this->sent($t, 4));
    }

    public function testTheClosedSetsMatchTheServer(): void
    {
        $this->assertEqualsCanonicalizing([
            'charge.paid', 'charge.settled', 'charge.failed', 'transfer.received',
            'payout.approved', 'payout.rejected', 'payout.expired', 'payout.cancelled', 'payout.paid',
            'payout.failed', 'payout_destination.added', 'payout_destination.removed', 'payout_lock.changed',
        ], EventType::all());
        $this->assertEqualsCanonicalizing([
            'quoted', 'pending_approval', 'approved', 'rejected', 'held', 'dispatched', 'paid', 'failed',
            'cancelled', 'expired',
        ], PayoutState::all());
        $this->assertEqualsCanonicalizing(['paid', 'failed', 'cancelled', 'rejected', 'expired'], PayoutState::terminal());
        $this->assertTrue(PayoutState::isTerminal(PayoutState::REJECTED));
        $this->assertFalse(PayoutState::isTerminal(PayoutState::PENDING_APPROVAL));
        $this->assertCount(42, ErrorCode::all());
    }

    public function testTheNewCodesRaiseTypedExceptions(): void
    {
        $expect = [
            'payout_approval_required' => Exception\ConflictException::class,
            'payout_not_approved' => Exception\ConflictException::class,
            'payout_approval_mismatch' => Exception\ConflictException::class,
            'payout_destinations_full' => Exception\ConflictException::class,
            'payout_destination_not_found' => Exception\NotFoundException::class,
            'payout_destination_locked' => Exception\MerchantException::class,
            'payout_open_requests_exceeded' => Exception\RateLimitException::class,
            'unknown_bank' => Exception\InvalidRequestException::class,
            'insufficient_balance' => Exception\InvalidRequestException::class,
            'bank_unavailable' => Exception\MerchantException::class,
            'account_not_found' => Exception\ApiException::class,
        ];
        foreach ($expect as $code => $class) {
            $e = Exception\ErrorFactory::fromResponse(400, json_encode(['error' => ['code' => $code, 'message' => 'm', 'request_id' => 'r']]), []);
            $this->assertInstanceOf($class, $e, $code);
            $this->assertSame($code, $e->errorCode);
        }
    }
}
