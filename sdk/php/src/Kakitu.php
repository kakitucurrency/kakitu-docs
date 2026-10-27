<?php

declare(strict_types=1);

namespace Kakitu;

use InvalidArgumentException;
use Kakitu\Exception\ApiException;
use Kakitu\Exception\ConnectionException;
use Kakitu\Exception\ErrorFactory;
use Kakitu\Exception\KakituException;
use Kakitu\Resources\Balances;
use Kakitu\Resources\Charges;
use Kakitu\Resources\Events;
use Kakitu\Resources\Limits;
use Kakitu\Resources\Merchants;
use Kakitu\Resources\Orders;
use Kakitu\Resources\Payouts;
use Kakitu\Resources\Quotes;
use Kakitu\Resources\Transfers;
use Kakitu\Transport\CurlTransport;
use Kakitu\Transport\TransportInterface;

/**
 * The Kakitu API client.
 *
 *     $kakitu = new Kakitu(['private_key' => getenv('KAKITU_PRIVATE_KEY')]);
 *     $me = $kakitu->merchants->me();
 *
 * Every request is signed with your wallet key automatically; there is nothing to sign by hand.
 *
 * Options:
 *   private_key  (required) 64 hex chars. Load it from an environment variable or secret store.
 *   base_url     default https://walletapi.kakitu.org (plain http only for localhost)
 *   timeout      seconds per attempt, default 30
 *   max_retries  extra attempts after the first on 429 rate_limited / 5xx / network errors, default 2
 *   transport    a TransportInterface (tests, custom HTTP stacks)
 *   clock        callable(): int unix seconds (tests)
 *   sleeper      callable(float): void (tests)
 */
final class Kakitu
{
    public const VERSION = '0.1.0';
    public const DEFAULT_BASE_URL = 'https://walletapi.kakitu.org';

    public readonly Merchants $merchants;
    public readonly Charges $charges;
    public readonly Transfers $transfers;
    public readonly Balances $balances;
    public readonly Orders $orders;
    public readonly Limits $limits;
    public readonly Quotes $quotes;
    public readonly Events $events;
    public readonly Payouts $payouts;

    private Signer $signer;
    private string $baseUrl;
    private float $timeout;
    private int $maxRetries;
    private TransportInterface $transport;
    /** @var callable(float): void */
    private $sleeper;

    /** @param array<string,mixed> $options */
    public function __construct(#[\SensitiveParameter] array $options)
    {
        $key = $options['private_key'] ?? null;
        if (!is_string($key) || $key === '') {
            throw new InvalidArgumentException("The 'private_key' option is required.");
        }
        $base = $options['base_url'] ?? self::DEFAULT_BASE_URL;
        if (!is_string($base)) {
            throw new InvalidArgumentException("'base_url' must be a string.");
        }
        $parts = parse_url($base);
        $host = strtolower((string) ($parts['host'] ?? ''));
        $scheme = strtolower((string) ($parts['scheme'] ?? ''));
        $local = in_array($host, ['localhost', '127.0.0.1', '::1', '[::1]'], true);
        if ($host === '' || !($scheme === 'https' || ($scheme === 'http' && $local))) {
            throw new InvalidArgumentException("'base_url' must be an https URL (http is allowed for localhost only).");
        }
        $this->baseUrl = rtrim($base, '/');
        $this->timeout = (float) ($options['timeout'] ?? 30);
        $this->maxRetries = max(0, (int) ($options['max_retries'] ?? 2));
        $this->transport = $options['transport'] ?? new CurlTransport();
        $this->sleeper = $options['sleeper'] ?? static function (float $s): void {
            usleep((int) ($s * 1_000_000));
        };
        $this->signer = new Signer($key, $options['clock'] ?? null);
        $this->merchants = new Merchants($this);
        $this->charges = new Charges($this);
        $this->transfers = new Transfers($this);
        $this->balances = new Balances($this);
        $this->orders = new Orders($this);
        $this->limits = new Limits($this);
        $this->quotes = new Quotes($this);
        $this->events = new Events($this);
        $this->payouts = new Payouts($this);
    }

    /** Your merchant identity: the wallet address derived from the private key. */
    public function address(): string
    {
        return $this->signer->address();
    }

    /**
     * Sends one signed API request, with retries. Resources use this; you rarely need to.
     *
     * $options:
     *   idempotency_key  a key of your own. Honoured on any route.
     *   idempotent       true for the three routes the server REQUIRES an Idempotency-Key on
     *                    (/v1/charges, /v1/transfers, /v1/payouts); a UUID is generated when the
     *                    caller supplied none.
     *
     * The flag is deliberately NOT `$method === 'POST'`. /v1/quotes, /v1/payouts/quote and
     * /v1/events/{id}/replay are POSTs that mount no idempotency at all, and /v1/merchants is an
     * upsert. Sending a key everywhere would be this SDK pretending a contract is uniform when
     * the server's is not.
     *
     * @param array<string,scalar> $query
     * @param array<mixed>|null    $body  JSON body (null for none)
     * @param array{idempotency_key?: string, idempotent?: bool} $options
     * @return array<string,mixed> decoded JSON
     * @throws KakituException
     */
    public function request(string $method, string $path, array $query = [], ?array $body = null, array $options = []): array
    {
        $method = strtoupper($method);

        $pathAndQuery = $path;
        $q = array_filter($query, static fn ($v): bool => $v !== null);
        if ($q !== []) {
            // Built ONCE: the exact string signed is the exact string sent.
            $pathAndQuery .= '?' . http_build_query($q, '', '&', PHP_QUERY_RFC3986);
        }

        $payload = '';
        if ($body !== null) {
            $payload = json_encode($body === [] ? new \stdClass() : $body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        }

        $headers = [
            'Accept' => 'application/json',
            'User-Agent' => 'kakitu-php/' . self::VERSION . ' php/' . PHP_VERSION,
        ];
        if ($body !== null) {
            $headers['Content-Type'] = 'application/json';
        }
        // One key for the whole call, reused by every retry: that is what makes a retry safe.
        if (isset($options['idempotency_key'])) {
            $headers['Idempotency-Key'] = $options['idempotency_key'];
        } elseif (($options['idempotent'] ?? false) === true) {
            $headers['Idempotency-Key'] = self::newIdempotencyKey();
        }

        $url = $this->baseUrl . $pathAndQuery;
        // The server verifies the path it receives. If base_url carries a prefix, that is part of it.
        $signedTarget = (string) parse_url($url, PHP_URL_PATH);
        $rawQuery = parse_url($url, PHP_URL_QUERY);
        if (is_string($rawQuery) && $rawQuery !== '') {
            $signedTarget .= '?' . $rawQuery;
        }

        $attempt = 0;
        while (true) {
            try {
                // Signed afresh per attempt: a fresh timestamp, and never an identical replay.
                $response = $this->transport->send(
                    $method,
                    $url,
                    $headers + $this->signer->headers($method, $signedTarget, $payload),
                    $payload === '' ? null : $payload,
                    $this->timeout,
                );
            } catch (ConnectionException $e) {
                if ($attempt >= $this->maxRetries) {
                    throw $e;
                }
                $this->backoff($attempt++, null);
                continue;
            }

            if ($response->status >= 200 && $response->status < 300) {
                return $this->decode($response->body, $response->headers, $response->status);
            }

            $error = ErrorFactory::fromResponse($response->status, $response->body, $response->headers);
            if ($attempt < $this->maxRetries && self::retryable($error)) {
                $this->backoff($attempt++, $response->headers['retry-after'] ?? null);
                continue;
            }
            throw $error;
        }
    }

    /** UUID v4, suitable as an Idempotency-Key. */
    public static function newIdempotencyKey(): string
    {
        $b = random_bytes(16);
        $b[6] = chr((ord($b[6]) & 0x0f) | 0x40);
        $b[8] = chr((ord($b[8]) & 0x3f) | 0x80);
        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($b), 4));
    }

    /**
     * 5xx and rate_limited only. Never any other 4xx. daily_cap_exceeded and
     * payer_velocity_exceeded are also HTTP 429 but are policy, not throttling: retrying in a
     * second cannot change the answer, so they are surfaced at once.
     */
    private static function retryable(KakituException $e): bool
    {
        if ($e->httpStatus === 429) {
            return $e->errorCode === ErrorCode::RATE_LIMITED;
        }
        return $e->httpStatus >= 500;
    }

    private function backoff(int $attempt, ?string $retryAfter): void
    {
        if ($retryAfter !== null && ctype_digit($retryAfter)) {
            $delay = min(30.0, (float) $retryAfter);
        } else {
            $delay = min(8.0, 0.5 * (2 ** $attempt)) * (0.5 + mt_rand() / (2 * mt_getrandmax()));
        }
        ($this->sleeper)($delay);
    }

    /**
     * @param array<string,string> $headers
     * @return array<string,mixed>
     */
    private function decode(string $body, array $headers, int $status): array
    {
        if (trim($body) === '') {
            return [];
        }
        $data = json_decode($body, true);
        if (!is_array($data)) {
            throw new ApiException(ErrorCode::INVALID_RESPONSE, 'Kakitu returned a response that is not JSON.', $headers['x-request-id'] ?? null, $status);
        }
        return $data;
    }

    public function __debugInfo(): array
    {
        return ['address' => $this->signer->address(), 'base_url' => $this->baseUrl];
    }
}
