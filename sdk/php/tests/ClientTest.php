<?php

declare(strict_types=1);

namespace Kakitu\Tests;

use InvalidArgumentException;
use Kakitu\ErrorCode;
use Kakitu\Exception;
use Kakitu\Kakitu;
use Kakitu\Signer;
use Kakitu\Transport\Response;
use PHPUnit\Framework\TestCase;

final class ClientTest extends TestCase
{
    private const KEY = '0x1ab42cc412b618bdea3a599e3c9bae199ebf030895b039e9db1e30dafb12b727';
    private const NOW = 1758240000;

    /** @var list<float> */
    private array $sleeps = [];

    private function client(FakeTransport $t, array $extra = []): Kakitu
    {
        $this->sleeps = [];
        return new Kakitu($extra + [
            'private_key' => self::KEY,
            'transport' => $t,
            'clock' => static fn (): int => self::NOW,
            'sleeper' => function (float $s): void { $this->sleeps[] = $s; },
        ]);
    }

    public function testMeSendsAGetSignedOverTheExactMessage(): void
    {
        $t = new FakeTransport(FakeTransport::json(200, ['state' => 'pending']));
        $me = $this->client($t)->merchants->me();

        $this->assertSame('pending', $me['state']);
        $r = $t->requests[0];
        $this->assertSame('GET', $r['method']);
        $this->assertSame('https://walletapi.kakitu.org/v1/merchants/me', $r['url']);
        $this->assertNull($r['body']);
        $this->assertArrayNotHasKey('Idempotency-Key', $r['headers']);
        $this->assertSame('0x9858EfFD232B4033E47d90003D41EC34EcaEda94', $r['headers']['X-Kakitu-Address']);

        $expected = (new Signer(self::KEY, fn () => self::NOW))->headers('GET', '/v1/merchants/me');
        $this->assertSame($expected['X-Kakitu-Signature'], $r['headers']['X-Kakitu-Signature']);
    }

    public function testQueryIsSignedByteForByteAsSent(): void
    {
        $t = new FakeTransport();
        $this->client($t)->charges->list(['reference' => 'order #1&x', 'limit' => 5, 'status' => null]);

        $r = $t->requests[0];
        $this->assertSame('https://walletapi.kakitu.org/v1/charges?reference=order%20%231%26x&limit=5', $r['url']);
        $expected = (new Signer(self::KEY, fn () => self::NOW))->headers('GET', '/v1/charges?reference=order%20%231%26x&limit=5');
        $this->assertSame($expected['X-Kakitu-Signature'], $r['headers']['X-Kakitu-Signature']);
    }

    public function testPostSignsTheExactBodyBytes(): void
    {
        $t = new FakeTransport();
        $params = ['business_name' => 'Wanjirũ & Sons', 'callback_url' => 'https://shop.example/hook'];
        $this->client($t)->merchants->register($params);

        $r = $t->requests[0];
        $this->assertSame('{"business_name":"Wanjirũ & Sons","callback_url":"https://shop.example/hook"}', $r['body']);
        $this->assertSame('application/json', $r['headers']['Content-Type']);
        // POST /v1/merchants is an upsert and the server mounts NO idempotency on it.
        $this->assertArrayNotHasKey('Idempotency-Key', $r['headers']);
        $expected = (new Signer(self::KEY, fn () => self::NOW))->headers('POST', '/v1/merchants', $r['body']);
        $this->assertSame($expected['X-Kakitu-Signature'], $r['headers']['X-Kakitu-Signature']);
    }

    public function testARouteThatRequiresAKeyGetsAGeneratedUuid(): void
    {
        $t = new FakeTransport();
        $this->client($t)->charges->create(['amount' => 100, 'phone' => '0712345678', 'reference' => 'o-1']);
        $this->assertMatchesRegularExpression(
            '/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/',
            $t->requests[0]['headers']['Idempotency-Key'],
        );
    }

    public function testCallerSuppliedIdempotencyKeyIsUsed(): void
    {
        $t = new FakeTransport();
        $this->client($t)->charges->create(['amount' => 100], ['idempotency_key' => 'order-1042']);
        $this->assertSame('order-1042', $t->requests[0]['headers']['Idempotency-Key']);
    }

    public function testEachCallGetsAFreshKey(): void
    {
        $t = new FakeTransport();
        $c = $this->client($t);
        $c->charges->create(['amount' => 1]);
        $c->charges->create(['amount' => 1]);
        $this->assertNotSame($t->requests[0]['headers']['Idempotency-Key'], $t->requests[1]['headers']['Idempotency-Key']);
    }

    public function testRetriesOn5xxWithTheSameKeyAndAFreshSignature(): void
    {
        $t = new FakeTransport(
            FakeTransport::error(503, ErrorCode::RAIL_UNAVAILABLE),
            FakeTransport::error(500, ErrorCode::INTERNAL),
            FakeTransport::json(201, ['ok' => true]),
        );
        $out = $this->client($t)->charges->create(['amount' => 100]);

        $this->assertSame(['ok' => true], $out);
        $this->assertCount(3, $t->requests);
        $this->assertCount(2, $this->sleeps);
        $keys = array_unique(array_map(fn ($r) => $r['headers']['Idempotency-Key'], $t->requests));
        $this->assertCount(1, $keys, 'a retry must reuse the key');
        $sigs = array_unique(array_map(fn ($r) => $r['headers']['X-Kakitu-Signature'], $t->requests));
        $this->assertCount(3, $sigs, 'identical re-signing inside one second would be refused as a replay');
        $stamps = array_map(fn ($r) => $r['headers']['X-Kakitu-Timestamp'], $t->requests);
        $this->assertSame([(string) self::NOW, (string) (self::NOW + 1), (string) (self::NOW + 2)], $stamps);
    }

    public function testRetriesOnRateLimitedAndHonoursRetryAfter(): void
    {
        $limited = new Response(429, json_encode(['error' => ['code' => 'rate_limited', 'message' => 'm', 'request_id' => 'r']]), ['retry-after' => '3']);
        $t = new FakeTransport($limited, FakeTransport::json(200, ['state' => 'approved']));
        $this->client($t)->merchants->me();
        $this->assertCount(2, $t->requests);
        $this->assertSame([3.0], $this->sleeps);
    }

    public function testRetriesNetworkErrorsThenGivesUp(): void
    {
        $e = static fn () => new Exception\ConnectionException(ErrorCode::CONNECTION_ERROR, 'boom');
        $t = new FakeTransport($e(), $e(), $e());
        try {
            $this->client($t)->merchants->me();
            $this->fail('expected exception');
        } catch (Exception\ConnectionException $x) {
            $this->assertSame(ErrorCode::CONNECTION_ERROR, $x->errorCode);
        }
        $this->assertCount(3, $t->requests, '1 attempt + 2 retries');
    }

    public function testMaxRetriesIsConfigurable(): void
    {
        $t = new FakeTransport(FakeTransport::error(500, 'internal'));
        $this->expectException(Exception\ApiException::class);
        try {
            $this->client($t, ['max_retries' => 0])->merchants->me();
        } finally {
            $this->assertCount(1, $t->requests);
        }
    }

    /** @return array<string,array{int,string}> */
    public static function neverRetried(): array
    {
        return [
            '400 invalid_request' => [400, 'invalid_request'],
            '401 unauthorized' => [401, 'unauthorized'],
            '403 merchant_not_approved' => [403, 'merchant_not_approved'],
            '404 charge_not_found' => [404, 'charge_not_found'],
            '409 idempotency_key_in_progress' => [409, 'idempotency_key_in_progress'],
            '409 reference_reused' => [409, 'reference_reused'],
            '429 daily_cap_exceeded (policy, not throttling)' => [429, 'daily_cap_exceeded'],
            '429 payer_velocity_exceeded' => [429, 'payer_velocity_exceeded'],
        ];
    }

    /** @dataProvider neverRetried */
    #[\PHPUnit\Framework\Attributes\DataProvider('neverRetried')]
    public function test4xxIsNeverRetried(int $status, string $code): void
    {
        $t = new FakeTransport(FakeTransport::error($status, $code), FakeTransport::json(200, []));
        try {
            $this->client($t)->charges->create(['amount' => 1]);
            $this->fail('expected exception');
        } catch (Exception\KakituException $e) {
            $this->assertSame($code, $e->errorCode);
        }
        $this->assertCount(1, $t->requests);
        $this->assertSame([], $this->sleeps);
    }

    public function testExceptionCarriesCodeMessageAndRequestId(): void
    {
        $t = new FakeTransport(FakeTransport::error(409, 'reference_reused', 'Already used.', 'req_abc'));
        try {
            $this->client($t)->charges->create(['amount' => 1]);
            $this->fail('expected exception');
        } catch (Exception\KakituException $e) {
            $this->assertInstanceOf(Exception\ConflictException::class, $e);
            $this->assertSame(ErrorCode::REFERENCE_REUSED, $e->errorCode);
            $this->assertSame('Already used.', $e->getMessage());
            $this->assertSame('req_abc', $e->requestId);
            $this->assertSame(409, $e->httpStatus);
        }
    }

    public function testEveryServerCodeMapsToATypedException(): void
    {
        $expect = [
            'invalid_request' => Exception\InvalidRequestException::class,
            'unauthorized' => Exception\AuthenticationException::class,
            'merchant_not_registered' => Exception\MerchantException::class,
            'merchant_not_approved' => Exception\MerchantException::class,
            'merchant_suspended' => Exception\MerchantException::class,
            'merchant_name_frozen' => Exception\MerchantException::class,
            'idempotency_key_required' => Exception\InvalidRequestException::class,
            'idempotency_key_invalid' => Exception\InvalidRequestException::class,
            'idempotency_key_reuse' => Exception\IdempotencyException::class,
            'idempotency_key_in_progress' => Exception\IdempotencyException::class,
            'idempotency_key_acted' => Exception\IdempotencyException::class,
            'idempotency_unavailable' => Exception\IdempotencyException::class,
            'request_too_large' => Exception\InvalidRequestException::class,
            'amount_below_minimum' => Exception\InvalidRequestException::class,
            'amount_above_maximum' => Exception\InvalidRequestException::class,
            'daily_cap_exceeded' => Exception\RateLimitException::class,
            'payer_velocity_exceeded' => Exception\RateLimitException::class,
            'rate_limited' => Exception\RateLimitException::class,
            'charge_not_found' => Exception\NotFoundException::class,
            'reference_reused' => Exception\ConflictException::class,
            'rail_unavailable' => Exception\ApiException::class,
            'order_not_found' => Exception\NotFoundException::class,
            'event_not_found' => Exception\NotFoundException::class,
            'payout_not_found' => Exception\NotFoundException::class,
            'payout_quote_not_found' => Exception\NotFoundException::class,
            'payouts_disabled' => Exception\MerchantException::class,
            // 429, but its OWN budget on its own counter: never folded into daily_cap_exceeded.
            'payout_daily_cap_exceeded' => Exception\RateLimitException::class,
            // 400, not 429: waiting does not help, a smaller payout does.
            'payout_amount_above_maximum' => Exception\InvalidRequestException::class,
            'profile_required' => Exception\ConflictException::class,
            'identity_verification_required' => Exception\ApiException::class,
            'internal' => Exception\ApiException::class,
        ];
        $this->assertEqualsCanonicalizing(ErrorCode::all(), array_keys($expect), 'covers the closed set');
        foreach ($expect as $code => $class) {
            $e = Exception\ErrorFactory::fromResponse(400, json_encode(['error' => ['code' => $code, 'message' => 'm', 'request_id' => 'r']]), []);
            $this->assertInstanceOf($class, $e, $code);
            $this->assertSame($code, $e->errorCode);
        }
    }

    public function testAuthMiddlewareErrorShapeIsUnderstood(): void
    {
        // auth/wallet.go answers {"error":"unauthorized","reason":"..."}: a string, not the envelope.
        $t = new FakeTransport(new Response(401, '{"error":"unauthorized","reason":"timestamp_out_of_range"}', ['x-request-id' => 'req_9']));
        try {
            $this->client($t)->merchants->me();
            $this->fail('expected exception');
        } catch (Exception\AuthenticationException $e) {
            $this->assertSame(ErrorCode::UNAUTHORIZED, $e->errorCode);
            $this->assertSame('timestamp_out_of_range', $e->reason);
            $this->assertSame('req_9', $e->requestId);
            $this->assertStringContainsString('clock', $e->getMessage());
        }
        $this->assertCount(1, $t->requests, '401 is never retried');
    }

    public function testNonJsonErrorBodyStillThrowsTyped(): void
    {
        $e = Exception\ErrorFactory::fromResponse(502, '<html>bad gateway</html>', []);
        $this->assertInstanceOf(Exception\ApiException::class, $e);
        $this->assertSame(502, $e->httpStatus);
    }

    public function testBaseUrlRules(): void
    {
        $this->assertInstanceOf(Kakitu::class, new Kakitu(['private_key' => self::KEY, 'base_url' => 'http://localhost:8080']));
        foreach (['http://walletapi.kakitu.org', 'ftp://x', 'not a url', ''] as $bad) {
            try {
                new Kakitu(['private_key' => self::KEY, 'base_url' => $bad]);
                $this->fail("accepted $bad");
            } catch (InvalidArgumentException) {
                $this->addToAssertionCount(1);
            }
        }
    }

    public function testMissingKeyIsRefused(): void
    {
        $this->expectException(InvalidArgumentException::class);
        new Kakitu([]);
    }

    public function testChargeIdIsPathEncodedAndSigned(): void
    {
        $t = new FakeTransport();
        $this->client($t)->charges->get('ch/1 2');
        $this->assertStringEndsWith('/v1/charges/ch%2F1%202', $t->requests[0]['url']);
    }

    /**
     * Regression: the server verifies Go's url.Path — the percent-DECODED path — plus the raw
     * query as received (auth/wallet.go RequestPath). Signing the escaped path made any id that
     * needed escaping a 401 bad_signature instead of the 404 the server means to answer.
     */
    public function testEscapedPathIdIsSignedAsTheServerReadsIt(): void
    {
        $t = new FakeTransport();
        $this->client($t)->charges->get('ch/1 2é');
        $r = $t->requests[0];
        $this->assertStringEndsWith('/v1/charges/ch%2F1%202%C3%A9', $r['url']);
        $expected = (new Signer(self::KEY, fn () => self::NOW))->headers('GET', '/v1/charges/ch/1 2é');
        $this->assertSame($expected['X-Kakitu-Signature'], $r['headers']['X-Kakitu-Signature']);
    }

    public function testEscapedPathIdOnAPostIsSignedDecoded(): void
    {
        $t = new FakeTransport();
        $this->client($t)->events->replay('evt 1');
        $r = $t->requests[0];
        $expected = (new Signer(self::KEY, fn () => self::NOW))->headers('POST', '/v1/events/evt 1/replay', $r['body'] ?? '');
        $this->assertSame($expected['X-Kakitu-Signature'], $r['headers']['X-Kakitu-Signature']);
    }

    public function testQueryWithQuoteCharactersIsSignedAsSent(): void
    {
        $t = new FakeTransport(FakeTransport::json(200, ['data' => [], 'next_cursor' => null]));
        $this->client($t)->charges->list(['reference' => "O'Brien (shop)!*"]);
        $r = $t->requests[0];
        $query = (string) parse_url($r['url'], PHP_URL_QUERY);
        $expected = (new Signer(self::KEY, fn () => self::NOW))->headers('GET', '/v1/charges?' . $query);
        $this->assertSame($expected['X-Kakitu-Signature'], $r['headers']['X-Kakitu-Signature']);
    }

    public function testClientDumpDoesNotLeakTheKey(): void
    {
        ob_start();
        var_dump($this->client(new FakeTransport()));
        $dump = (string) ob_get_clean();
        $this->assertStringNotContainsString(substr(self::KEY, 2, 20), $dump);
    }
}
