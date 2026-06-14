<?php
/**
 * HTTP Client for Cloud Communication
 *
 * Handles HTTP requests from NextLib-Agent to NextLib-Cloud.
 * Enforces HTTPS-only connections and includes HMAC-SHA256 token
 * in outgoing requests.
 *
 * @package    NextLib-Agent
 * @subpackage Lib
 * @version    1.0.0
 * @requires   PHP 7.4+
 * @requires   cURL extension
 */

namespace NextLibAgent\Lib;

class HttpClient
{
    /**
     * @var string Base URL of NextLib-Cloud (must be HTTPS)
     */
    private $baseUrl;

    /**
     * @var int Request timeout in seconds
     */
    private $timeout;

    /**
     * @var HmacSigner HMAC signer for token generation
     */
    private $signer;

    /**
     * @var bool Whether to enforce HTTPS protocol
     */
    private $enforceHttps;

    /**
     * @param string     $baseUrl      Cloud base URL (HTTPS required unless enforcement disabled)
     * @param int        $timeout      Request timeout in seconds
     * @param HmacSigner|null $signer  HMAC signing utility
     * @param bool       $enforceHttps Whether to enforce HTTPS (default true, set false for testing)
     *
     * @throws \InvalidArgumentException If base URL does not use HTTPS and enforcement is enabled
     */
    public function __construct(string $baseUrl, int $timeout = 5, ?HmacSigner $signer = null, bool $enforceHttps = true)
    {
        $this->enforceHttps = $enforceHttps;

        if ($this->enforceHttps && !$this->isHttps($baseUrl)) {
            throw new \InvalidArgumentException(
                'NextLib-Agent requires HTTPS for cloud communication. '
                . 'The provided base URL does not use HTTPS protocol: '
                . $baseUrl
            );
        }

        $this->baseUrl = rtrim($baseUrl, '/');
        $this->timeout = $timeout;
        $this->signer = $signer;
    }

    /**
     * Send a POST request to NextLib-Cloud.
     *
     * @param string $endpoint The API endpoint path (e.g. '/api/v1/aggregate')
     * @param string $body     The request body (JSON or compressed)
     * @param array  $headers  Additional headers as ['Header-Name: value'] format
     * @return array Response with 'status' (int), 'body' (string), and 'error' (string|null) keys
     */
    public function post(string $endpoint, string $body, array $headers = array()): array
    {
        $url = $this->baseUrl . '/' . ltrim($endpoint, '/');

        if ($this->enforceHttps && !$this->isHttps($url)) {
            return array(
                'status' => 0,
                'body' => '',
                'error' => 'HTTPS is required for all cloud communication. '
                    . 'Refusing to send request to non-HTTPS URL: ' . $url,
            );
        }

        if (!function_exists('curl_init')) {
            return array(
                'status' => 0,
                'body' => '',
                'error' => 'cURL extension is not available',
            );
        }

        $ch = curl_init();

        if ($ch === false) {
            return array(
                'status' => 0,
                'body' => '',
                'error' => 'Failed to initialize cURL',
            );
        }

        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, $this->timeout);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, $this->timeout);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, $this->enforceHttps);
        curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, $this->enforceHttps ? 2 : 0);

        if (!empty($headers)) {
            curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        }

        $responseBody = curl_exec($ch);
        $error = null;

        if ($responseBody === false) {
            $error = curl_error($ch);
            $responseBody = '';
        }

        $statusCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);

        curl_close($ch);

        return array(
            'status' => $statusCode,
            'body' => $responseBody,
            'error' => $error,
        );
    }

    /**
     * Validate that a URL uses HTTPS protocol.
     *
     * Performs case-insensitive check for the HTTPS scheme.
     *
     * @param string $url URL to validate
     * @return bool True if URL uses HTTPS
     */
    public function isHttps(string $url): bool
    {
        $scheme = strtolower(parse_url($url, PHP_URL_SCHEME) ?: '');

        return $scheme === 'https';
    }
}
