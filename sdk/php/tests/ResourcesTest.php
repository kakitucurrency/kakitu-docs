<?php

declare(strict_types=1);

namespace Kakitu\Tests;

use InvalidArgumentException;
use Kakitu\EventType;
use Kakitu\Kakitu;
use Kakitu\Pagination;
use Kakitu\PayoutState;
use PHPUnit\Framework\TestCase;

/**
 * The resources added for the rest of the developer API: idempotency where the server demands it
 * and nowhere else, the one cursor pager, and the shapes that carry caller-produced signatures
 * the SDK must never invent.
 */
final class ResourcesTest extends TestCase
{
    private const KEY = '0x1ab42cc412b618bdea3a599e3c9bae199ebf030895b039e9db1e30dafb12b727';
    private const NOW = 1758240000;

    /** A transfer the CALLER signed. The SDK carries these bytes through untouched. */
    private const SIGNED = [
        'from' => '0xMe',
        'to' => '0xYou',
        'value_wei' => '1000000000000000000000',
        'deadline' => 1758240600,
        'v' => 27,
        'r' => '0x1111111111111111111111111111111111111111111111111111111111111111',
        's' => '0x2222222222222222222222222222222222222222222222222222222222222222',
        'iv' => 28,
        'ir' => '0x3333333333333333333333333333333333333333333333333333333333333333',
        'is' => '0x4444444444444444444444444444444444444444444444444444444444444444',
    ];

    private function client(FakeTransport $t): Kakitu
    {
        return new Kakitu([
            'private_key' => self::KEY,
            'transport' => $t,
            'clock' => static fn (): int => self::NOW,
            'sleeper' => static function (float $s): void {},
        ]);
    }

    // ----------------------------------------------------------- idempotency

    public function testTheThreeRoutesThatRequireAKeySendAGeneratedOne(): void
    {
        $uuid = '/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/';
        $calls = [
            '/v1/charges' => fn (Kakitu $k) => $k->charges->create(['amount' => 1, 'phone' => 'p', 'reference' => 'r']),
            '/v1/transfers' => fn (Kakitu $k) => $k->transfers->create(self::SIGNED),
            '/v1/payouts' => fn (Kakitu $k) => $k->payouts->create('pq_1', self::SIGNED),
        ];
        foreach ($calls as $path => $call) {
            $t = new FakeTransport();
            $call($this->client($t));
            $this->assertMatchesRegularExpression($uuid, $t->requests[0]['headers']['Idempotency-Key'], $path);
        }
    }

    public function testThoseRoutesHonourTheCallersOwnKey(): void
    {
        $t = new FakeTransport();
        $k = $this->client($t);
        $k->charges->create(['amount' => 1], ['idempotency_key' => 'mine-c']);
        $k->transfers->create(self::SIGNED, ['idempotency_key' => 'mine-t']);
        $k->payouts->create('q', self::SIGNED, ['idempotency_key' => 'mine-p']);
        $this->assertSame(
            ['mine-c', 'mine-t', 'mine-p'],
            array_map(static fn (array $r): string => $r['headers']['Idempotency-Key'], $t->requests),
        );
    }

    /**
     * The whole point of the per-route flag: these are POSTs, and the server mounts no
     * idempotency on any of them. A blanket "POST => send a key" would send one here.
     */
    public function testNoKeyIsSentWhereTheServerMountsNone(): void
    {
        $t = new FakeTransport();
        $k = $this->client($t);
        $k->quotes->create(['type' => 'deposit', 'amount_kes' => 1000, 'phone' => '0712345678']);
        $k->payouts->quote(['amount_kes' => 1000, 'beneficiary' => ['phone' => '254712345678', 'name' => 'A N']]);
        $k->events->replay('ev-1');
        $k->merchants->register(['business_name' => 'B', 'contact_email' => 'a@b.co']);

        $paths = ['/v1/quotes', '/v1/payouts/quote', '/v1/events/ev-1/replay', '/v1/merchants'];
        foreach ($t->requests as $i => $r) {
            $this->assertSame('POST', $r['method']);
            $this->assertStringEndsWith($paths[$i], $r['url']);
            $this->assertArrayNotHasKey('Idempotency-Key', $r['headers'], $paths[$i]);
        }
    }

    public function testReadsNeverSendAKey(): void
    {
        $t = new FakeTransport();
        $k = $this->client($t);
        $k->balances->retrieve();
        $k->limits->retrieve();
        $k->orders->get('o-1');
        $k->payouts->get('p-1');
        $k->events->list();
        $k->payouts->list();
        $k->charges->list();

        $this->assertCount(7, $t->requests);
        foreach ($t->requests as $r) {
            $this->assertSame('GET', $r['method']);
            $this->assertArrayNotHasKey('Idempotency-Key', $r['headers'], $r['url']);
        }
    }

    // ------------------------------------------------------------ pagination

    public function testAutoPageWalksATwoPageResponse(): void
    {
        $seen = [];
        $pages = [
            ['data' => [['id' => 'a'], ['id' => 'b']], 'next_cursor' => 'cur-2'],
            ['data' => [['id' => 'c']], 'next_cursor' => null],
        ];
        $rows = iterator_to_array(Pagination::autoPage(function (array $f) use (&$seen, $pages): array {
            $seen[] = $f['cursor'] ?? null;
            return $pages[count($seen) - 1];
        }), false);

        $this->assertSame(['a', 'b', 'c'], array_column($rows, 'id'));
        $this->assertSame([null, 'cur-2'], $seen, "page 2 must ask for page 1's next_cursor");
    }

    public function testAutoPageStopsInsteadOfLoopingOnARepeatedCursor(): void
    {
        $n = 0;
        $rows = iterator_to_array(Pagination::autoPage(static function () use (&$n): array {
            return ['data' => [['id' => $n++]], 'next_cursor' => 'same'];
        }), false);
        $this->assertSame([0, 1], array_column($rows, 'id'));
    }

    public function testTheCallersOwnCursorIsIgnoredSoAWalkAlwaysStartsAtPageOne(): void
    {
        $seen = [];
        iterator_to_array(Pagination::autoPage(function (array $f) use (&$seen): array {
            $seen[] = $f['cursor'] ?? null;
            return ['data' => [], 'next_cursor' => null];
        }, ['cursor' => 'stale', 'status' => 'held']), false);
        $this->assertSame([null], $seen);
    }

    /** All three lists page identically; one pager serves them. */
    public function testEveryListPagesTheSameWay(): void
    {
        $lists = [
            '/v1/charges' => static fn (Kakitu $k): \Generator => $k->charges->autoPagingIterator(['limit' => 2]),
            '/v1/events' => static fn (Kakitu $k): \Generator => $k->events->autoPagingIterator(['limit' => 2]),
            '/v1/payouts' => static fn (Kakitu $k): \Generator => $k->payouts->autoPagingIterator(['limit' => 2]),
        ];
        foreach ($lists as $path => $walk) {
            $t = new FakeTransport(
                FakeTransport::json(200, ['data' => [['id' => 'a'], ['id' => 'b']], 'next_cursor' => 'op-aque==']),
                FakeTransport::json(200, ['data' => [['id' => 'c']], 'next_cursor' => null]),
            );
            $rows = iterator_to_array($walk($this->client($t)), false);
            $this->assertSame(['a', 'b', 'c'], array_column($rows, 'id'), $path);
            $this->assertCount(2, $t->requests, $path);
            $this->assertStringEndsWith($path . '?limit=2', $t->requests[0]['url'], $path);
            // next_cursor goes back verbatim (url-encoded in transit), never parsed or rebuilt.
            $this->assertStringEndsWith($path . '?limit=2&cursor=op-aque%3D%3D', $t->requests[1]['url'], $path);
        }
    }

    public function testListReturnsTheRawPageSoACallerCanHoldTheCursorItself(): void
    {
        $t = new FakeTransport(FakeTransport::json(200, [
            'data' => [['id' => 'po_1', 'status' => 'held']], 'next_cursor' => 'c2',
        ]));
        $page = $this->client($t)->payouts->list(['status' => PayoutState::HELD, 'limit' => 1]);
        $this->assertSame('c2', $page['next_cursor']);
        $this->assertCount(1, $page['data']);
        $this->assertStringEndsWith('/v1/payouts?status=held&limit=1', $t->requests[0]['url']);
    }

    // -------------------------------------- the caller's signatures, carried

    public function testTransferPostsTheSignedRequestVerbatim(): void
    {
        $t = new FakeTransport(FakeTransport::json(202, ['id' => '0xabc', 'status' => 'pending']));
        $out = $this->client($t)->transfers->create(self::SIGNED);

        $this->assertSame(['id' => '0xabc', 'status' => 'pending'], $out);
        $body = json_decode($t->requests[0]['body'], true);
        $this->assertSame(self::SIGNED, $body);
        // A string on the wire. Through a float this is 1.0E+21 and the signature fails.
        $this->assertSame('1000000000000000000000', $body['value_wei']);
    }

    public function testPayoutConfirmNestsTheSignedTransfer(): void
    {
        $t = new FakeTransport(FakeTransport::json(202, ['id' => 'po_1', 'status' => 'held']));
        $out = $this->client($t)->payouts->create('pq_9', self::SIGNED);

        $this->assertSame(PayoutState::HELD, $out['status']);
        $body = json_decode($t->requests[0]['body'], true);
        $this->assertSame(['quote_id', 'transfer'], array_keys($body));
        $this->assertSame(self::SIGNED, $body['transfer']);
    }

    public function testAHalfSignedTransferIsRefusedBeforeItCostsARoundTrip(): void
    {
        $t = new FakeTransport();
        $half = self::SIGNED;
        unset($half['is']);          // the Relay intent's s, the easiest half to forget
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage("missing 'is'");
        $this->client($t)->transfers->create($half);
    }

    public function testValueWeiAsANumberIsRefused(): void
    {
        $t = new FakeTransport();
        $bad = self::SIGNED;
        $bad['value_wei'] = 1000000000000000000000;  // a float by the time PHP is done with it
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('decimal STRING');
        $this->client($t)->transfers->create($bad);
    }

    public function testPayoutCreateRefusesAnEmptyQuoteId(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->client(new FakeTransport())->payouts->create('  ', self::SIGNED);
    }

    // ------------------------------------------------------------ the shapes

    public function testPayoutQuoteCarriesBothEip712Domains(): void
    {
        $t = new FakeTransport(FakeTransport::json(200, [
            'quote_id' => 'pq_1', 'amount_kes' => 5000, 'fee_kes' => 50, 'send_kes' => 5050,
            'currency' => 'KES', 'beneficiary' => ['phone' => '254712345678', 'name' => 'A Mwangi'],
            'value_wei' => '5050000000000000000000', 'treasury_address' => '0xTreasury',
            'deadline' => 1758240600,
            'eip712' => [
                'permit' => ['name' => 'KSHS', 'version' => '1', 'chain_id' => 8453, 'verifying_contract' => '0xTok'],
                'relay' => ['name' => 'Fwd', 'version' => '1', 'chain_id' => 8453, 'verifying_contract' => '0xFwd'],
            ],
        ]));
        $q = $this->client($t)->payouts->quote([
            'amount_kes' => 5000,
            'beneficiary' => ['phone' => '254712345678', 'name' => 'A Mwangi'],
        ]);
        // The two domains differ, which is exactly why both are published.
        $this->assertSame('0xTok', $q['eip712']['permit']['verifying_contract']);
        $this->assertSame('0xFwd', $q['eip712']['relay']['verifying_contract']);
        $this->assertIsString($q['value_wei']);
    }

    public function testLimitsKeepsNullDistinctFromZero(): void
    {
        $t = new FakeTransport(FakeTransport::json(200, [
            'withdrawal' => ['min_kes' => 50, 'max_kes' => 150000, 'source' => 'live'],
            'payout' => [
                'enabled' => true, 'max_kes' => 70000, 'daily_cap_kes' => 500000,
                'hold_above_kes' => 20000, 'remaining_today_kes' => null, 'note' => 'n',
            ],
            'max_staleness_seconds' => 300, 'note' => 'n',
        ]));
        $l = $this->client($t)->limits->retrieve();
        $this->assertSame(20000, $l['payout']['hold_above_kes']);
        // null is "could not be read", NOT an empty budget.
        $this->assertNull($l['payout']['remaining_today_kes']);
        $this->assertArrayHasKey('remaining_today_kes', $l['payout']);
    }

    public function testLimitsHasNoPayoutBlockForAPlainWallet(): void
    {
        $t = new FakeTransport(FakeTransport::json(200, [
            'withdrawal' => ['min_kes' => 50, 'max_kes' => 1000, 'source' => 'estimated'],
            'max_staleness_seconds' => 300, 'note' => 'n',
        ]));
        $this->assertArrayNotHasKey('payout', $this->client($t)->limits->retrieve());
    }

    public function testEventReplayKeepsTheSameIdAndAnswers202(): void
    {
        $t = new FakeTransport(FakeTransport::json(202, [
            'id' => 'ev-7', 'type' => EventType::CHARGE_PAID, 'status' => EventType::STATUS_PENDING,
            'attempts' => 0, 'charge_id' => 'ch_1', 'payout_id' => null, 'payload' => ['id' => 'ev-7'],
        ]));
        $e = $this->client($t)->events->replay('ev-7');
        // The id does NOT change on a replay: that is what lets a receiver dedupe.
        $this->assertSame('ev-7', $e['id']);
        $this->assertSame(EventType::STATUS_PENDING, $e['status']);
        $this->assertSame(0, $e['attempts']);
    }

    public function testIdsAreEscapedIntoThePath(): void
    {
        $t = new FakeTransport();
        $this->client($t)->orders->get('o1/../admin');
        $this->assertStringEndsWith('/v1/orders/o1%2F..%2Fadmin', $t->requests[0]['url']);
    }

    public function testEmptyIdsAreRefused(): void
    {
        $k = $this->client(new FakeTransport());
        foreach ([
            static fn () => $k->orders->get(' '),
            static fn () => $k->payouts->get(''),
            static fn () => $k->events->replay(''),
        ] as $call) {
            try {
                $call();
                $this->fail('expected an InvalidArgumentException');
            } catch (InvalidArgumentException $e) {
                $this->assertNotEmpty($e->getMessage());
            }
        }
    }

    // ------------------------------------------------------- the closed sets

    public function testPayoutStatesAreTheSevenTheServerPublishes(): void
    {
        $this->assertSame(
            ['quoted', 'held', 'dispatched', 'paid', 'failed', 'cancelled', 'expired'],
            PayoutState::all(),
        );
        $this->assertSame(['paid', 'failed', 'cancelled', 'expired'], PayoutState::terminal());
        $this->assertTrue(PayoutState::isTerminal(PayoutState::EXPIRED));
        // held is NOT terminal: a person releases or cancels it.
        $this->assertFalse(PayoutState::isTerminal(PayoutState::HELD));
        $this->assertFalse(PayoutState::isTerminal('not-a-state'));
    }

    public function testEventTypesAreTheFiveTheServerRaises(): void
    {
        $this->assertSame(
            ['charge.paid', 'charge.settled', 'charge.failed', 'payout.expired', 'payout.cancelled'],
            EventType::all(),
        );
        $this->assertSame(['pending', 'delivered', 'abandoned'], EventType::statuses());
    }
}
