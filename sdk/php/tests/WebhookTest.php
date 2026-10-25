<?php

declare(strict_types=1);

namespace Kakitu\Tests;

use Kakitu\ErrorCode;
use Kakitu\Exception\SignatureVerificationException;
use Kakitu\Webhook;
use PHPUnit\Framework\TestCase;

final class WebhookTest extends TestCase
{
    private const SECRET = 'whsec_PLACEHOLDER_not_a_real_secret';
    private const BODY = '{"id":"ev_1","type":"charge.settled"}';

    public function testSignatureFormatMatchesThePlannedServerScheme(): void
    {
        // webhookout.Sign: t=<unix>,v1=<hex hmac over "t.body">
        $this->assertSame(
            't=1700000000,v1=' . hash_hmac('sha256', '1700000000.' . self::BODY, self::SECRET),
            Webhook::sign(self::SECRET, 1700000000, self::BODY),
        );
    }

    public function testValidSignatureVerifiesAndDecodes(): void
    {
        $h = Webhook::sign(self::SECRET, 1700000000, self::BODY);
        $this->assertTrue(Webhook::verify(self::BODY, $h, self::SECRET, 300, 1700000100));
        $this->assertSame('ev_1', Webhook::constructEvent(self::BODY, $h, self::SECRET, 300, 1700000100)['id']);
    }

    public function testTamperedBodyWrongSecretAndGarbageAreRejected(): void
    {
        $h = Webhook::sign(self::SECRET, 1700000000, self::BODY);
        $this->assertFalse(Webhook::verify(self::BODY . ' ', $h, self::SECRET, 300, 1700000000));
        $this->assertFalse(Webhook::verify(self::BODY, $h, 'other', 300, 1700000000));
        $this->assertFalse(Webhook::verify(self::BODY, '', self::SECRET, 300, 1700000000));
        $this->assertFalse(Webhook::verify(self::BODY, 'v1=abc', self::SECRET, 300, 1700000000));
        $this->assertFalse(Webhook::verify(self::BODY, $h, '', 300, 1700000000));
    }

    public function testOldTimestampIsRejectedAsReplay(): void
    {
        $h = Webhook::sign(self::SECRET, 1700000000, self::BODY);
        $this->assertTrue(Webhook::verify(self::BODY, $h, self::SECRET, 300, 1700000300));
        $this->assertFalse(Webhook::verify(self::BODY, $h, self::SECRET, 300, 1700000301));
    }

    public function testChangingTheTimestampInTheHeaderBreaksTheSignature(): void
    {
        $h = Webhook::sign(self::SECRET, 1700000000, self::BODY);
        $forged = preg_replace('/^t=\d+/', 't=1700000200', $h);
        $this->assertFalse(Webhook::verify(self::BODY, $forged, self::SECRET, 300, 1700000200));
    }

    public function testAnyOfSeveralV1SignaturesMayMatch(): void
    {
        $h = Webhook::sign(self::SECRET, 1700000000, self::BODY);
        $this->assertTrue(Webhook::verify(self::BODY, 'v1=deadbeef,' . $h, self::SECRET, 300, 1700000000));
    }

    public function testConstructEventThrowsATypedException(): void
    {
        try {
            Webhook::constructEvent(self::BODY, 't=1,v1=00', self::SECRET);
            $this->fail('expected exception');
        } catch (SignatureVerificationException $e) {
            $this->assertSame(ErrorCode::WEBHOOK_SIGNATURE_INVALID, $e->errorCode);
        }
    }
}
