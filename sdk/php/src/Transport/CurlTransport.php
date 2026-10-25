<?php

declare(strict_types=1);

namespace Kakitu\Transport;

use Kakitu\ErrorCode;
use Kakitu\Exception\ConnectionException;

final class CurlTransport implements TransportInterface
{
    public function send(string $method, string $url, array $headers, ?string $body, float $timeout): Response
    {
        $ch = curl_init($url);
        if ($ch === false) {
            throw new ConnectionException(ErrorCode::CONNECTION_ERROR, 'Could not initialise cURL.');
        }
        $lines = [];
        foreach ($headers as $name => $value) {
            $lines[] = $name . ': ' . $value;
        }
        $responseHeaders = [];
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => $lines,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_TIMEOUT_MS => (int) ($timeout * 1000),
            CURLOPT_CONNECTTIMEOUT_MS => (int) (min($timeout, 10.0) * 1000),
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_HEADERFUNCTION => static function ($c, string $line) use (&$responseHeaders): int {
                $parts = explode(':', $line, 2);
                if (count($parts) === 2) {
                    $responseHeaders[strtolower(trim($parts[0]))] = trim($parts[1]);
                }
                return strlen($line);
            },
        ]);
        if ($body !== null && $body !== '') {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        }
        $raw = curl_exec($ch);
        if ($raw === false) {
            $msg = curl_error($ch);
            curl_close($ch);
            throw new ConnectionException(ErrorCode::CONNECTION_ERROR, 'Network error talking to Kakitu: ' . $msg);
        }
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);

        return new Response($status, (string) $raw, $responseHeaders);
    }
}
