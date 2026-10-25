<?php

declare(strict_types=1);

namespace Kakitu\Transport;

final class Response
{
    /** @param array<string,string> $headers lowercase header name => value */
    public function __construct(
        public readonly int $status,
        public readonly string $body,
        public readonly array $headers = [],
    ) {
    }
}
