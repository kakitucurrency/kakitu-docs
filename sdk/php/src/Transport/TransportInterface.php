<?php

declare(strict_types=1);

namespace Kakitu\Transport;

use Kakitu\Exception\ConnectionException;

interface TransportInterface
{
    /**
     * Performs one HTTP request. Must NOT follow redirects (a redirect would drop the signature
     * onto an unsigned URL) and must throw only on transport failure, never on an HTTP status.
     *
     * @param array<string,string> $headers
     * @throws ConnectionException
     */
    public function send(string $method, string $url, array $headers, ?string $body, float $timeout): Response;
}
