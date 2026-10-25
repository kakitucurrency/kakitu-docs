<?php

declare(strict_types=1);

namespace Kakitu\Tests;

use InvalidArgumentException;
use Kakitu\Signer;
use PHPUnit\Framework\TestCase;

/**
 * Pins the signing contract. The vectors below were produced by the SERVER's own code
 * (`go run ./cmd/kakitu-vectors` in kakitu-wallet-server, auth.Message + auth.Sign), so a pass
 * here means the PHP signature is byte-identical to what the Go server would produce and accept.
 *
 * The key is the public BIP-39 "abandon ... about" test key: published everywhere, never funded.
 */
final class SignerTest extends TestCase
{
    private const TEST_KEY = '0x1ab42cc412b618bdea3a599e3c9bae199ebf030895b039e9db1e30dafb12b727';
    private const TEST_ADDRESS = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94';
    private const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

    /** @return array<string,array{string,string,int,string,string,string}> */
    public static function vectors(): array
    {
        return [
            'GET, no query, no body' => [
                'GET', '/profile', 1758240000, '',
                'GET /profile 1758240000 ' . self::EMPTY_SHA256,
                '0x726acc038966cde70c4a8af96732a6adb5098d68551a8d8e129b4fbf1ac6803b54040d561323b41f5fe374d06538d474eb0d6694067fa7b45500a1be6f3bfe741b',
            ],
            'GET with a query' => [
                'GET', '/kyc/state?country=KE&tier=basic', 1758240001, '',
                'GET /kyc/state?country=KE&tier=basic 1758240001 ' . self::EMPTY_SHA256,
                '0x3660f0431d31e727a8ba5f33c788812c6a25e8507b9c2479324ed1259ad047fe6c44925337052d4037a86ade58ef860a890f3f7bfaeec5331deaf78e1fe50e681b',
            ],
            'POST with a body' => [
                'POST', '/ramp/deposit', 1758240002, '{"amount_kes":1000,"phone":"+254700000000"}',
                'POST /ramp/deposit 1758240002 7a4c4c0f0333102cffe5a64621024fe6d094cbcc71d771c251a3600c43ac19a6',
                '0x300fa9012768e1bcd22614d77d7724be7cdad84bbf65f482b536860ce0eb5a4e2329986faa234254388022acfb3f9c7640778bfc2021cc6eca0848f1556f6f171c',
            ],
            'POST with an empty body' => [
                'POST', '/ramp/order/2f1c2b3a-0000-4000-8000-000000000001/paid', 1758240003, '',
                'POST /ramp/order/2f1c2b3a-0000-4000-8000-000000000001/paid 1758240003 ' . self::EMPTY_SHA256,
                '0xd5382dc7e751d1ec43d4cf9773e9c77b9799344d6190ab177dc1619acd6f546c6b2c56d853512bc0244f8e570d0746cfee51127304026bec600579ee3843cb3a1b',
            ],
            'POST with body and query' => [
                'POST', '/ramp/pay?idempotency=abc123', 1758240004, '{"quote_id":"q-1"}',
                'POST /ramp/pay?idempotency=abc123 1758240004 d36c4e0fd755f1eb046ae995ee1f1f815738b66c05ad65ea8bde616915d05f6c',
                '0xfc139b5bb5b936f4b21ee87d0fa0b180687966889ba4fc5ee70bcacced1009bd1d53fb46ccd54ea01d1a9836fc268ef4b483f5f399f8f606d790abee1cb16bc71c',
            ],
            'POST with a multi-byte UTF-8 body' => [
                'POST', '/profile', 1758240005, '{"first_name":"Wanjirũ","last_name":"Müller"}',
                'POST /profile 1758240005 4012cc195d55431b98c41a25accdb1820f42a1c5e429fde8a23b5f1f93051934',
                '0xf18af8ae170b21bea5b22c938227c08f99c74ec5fa3f052a06579f369ed018b163720318fcb16492703b164f08f585e9ddb11be583987e7ba08395d6d3b16b9d1b',
            ],
        ];
    }

    /** @dataProvider vectors */
    #[\PHPUnit\Framework\Attributes\DataProvider('vectors')]
    public function testSignedStringAndSignatureMatchTheServer(string $method, string $target, int $ts, string $body, string $message, string $signature): void
    {
        $this->assertSame($message, Signer::message($method, $target, $ts, $body), 'exact signed string');

        $signer = new Signer(self::TEST_KEY, static fn (): int => $ts);
        $headers = $signer->headers($method, $target, $body);

        $this->assertSame(self::TEST_ADDRESS, $headers['X-Kakitu-Address']);
        $this->assertSame((string) $ts, $headers['X-Kakitu-Timestamp']);
        $this->assertSame($signature, $headers['X-Kakitu-Signature']);
    }

    public function testMethodIsUppercasedInTheMessage(): void
    {
        $this->assertSame('GET /x 1 ' . self::EMPTY_SHA256, Signer::message('get', '/x', 1, ''));
    }

    public function testKeyWithoutPrefixAndUppercaseGiveTheSameAddress(): void
    {
        $this->assertSame(self::TEST_ADDRESS, (new Signer(substr(self::TEST_KEY, 2)))->address());
        $this->assertSame(self::TEST_ADDRESS, (new Signer(strtoupper(self::TEST_KEY)))->address());
    }

    public function testBadKeysAreRefusedWithoutEchoingThem(): void
    {
        foreach (['', 'nothex', '0x1234', str_repeat('0', 64), str_repeat('f', 64)] as $bad) {
            try {
                new Signer($bad);
                $this->fail('accepted a bad key');
            } catch (InvalidArgumentException $e) {
                if ($bad !== '') {
                    $this->assertStringNotContainsString($bad, $e->getMessage());
                }
            }
        }
    }

    public function testRetryInTheSameSecondGetsADifferentTimestamp(): void
    {
        $signer = new Signer(self::TEST_KEY, static fn (): int => 1758240000);
        $a = $signer->headers('POST', '/v1/charges', '{"a":1}');
        $b = $signer->headers('POST', '/v1/charges', '{"a":1}');
        $c = $signer->headers('POST', '/v1/charges', '{"a":2}');

        $this->assertSame('1758240000', $a['X-Kakitu-Timestamp']);
        $this->assertSame('1758240001', $b['X-Kakitu-Timestamp'], 'an identical repeat would be refused as a replay');
        $this->assertSame('1758240000', $c['X-Kakitu-Timestamp'], 'a different body is a different request');
    }

    public function testThePrivateKeyNeverAppearsInDumpsOrSerialization(): void
    {
        $signer = new Signer(self::TEST_KEY);
        ob_start();
        var_dump($signer);
        print_r($signer);
        $dump = (string) ob_get_clean();
        $this->assertStringNotContainsString(substr(self::TEST_KEY, 2, 20), $dump);
        $this->assertStringContainsString(self::TEST_ADDRESS, $dump);

        $this->expectException(\LogicException::class);
        serialize($signer);
    }
}
