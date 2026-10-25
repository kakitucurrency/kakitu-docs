<?php

declare(strict_types=1);

namespace Kakitu\Tests;

use Kakitu\Exception\ConnectionException;
use Kakitu\Transport\Response;
use Kakitu\Transport\TransportInterface;

final class FakeTransport implements TransportInterface
{
    /** @var list<array{method:string,url:string,headers:array<string,string>,body:?string}> */
    public array $requests = [];
    /** @var list<Response|ConnectionException> */
    private array $queue;

    public function __construct(Response|ConnectionException ...$queue)
    {
        $this->queue = array_values($queue);
    }

    public function send(string $method, string $url, array $headers, ?string $body, float $timeout): Response
    {
        $this->requests[] = compact('method', 'url', 'headers', 'body');
        $next = array_shift($this->queue) ?? new Response(200, '{}');
        if ($next instanceof ConnectionException) {
            throw $next;
        }
        return $next;
    }

    public static function json(int $status, array $data, array $headers = []): Response
    {
        return new Response($status, json_encode($data), $headers);
    }

    public static function error(int $status, string $code, string $message = 'msg', string $rid = 'req_1'): Response
    {
        return self::json($status, ['error' => ['code' => $code, 'message' => $message, 'request_id' => $rid]]);
    }
}
