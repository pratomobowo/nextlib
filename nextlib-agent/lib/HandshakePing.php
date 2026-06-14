<?php
/**
 * Handshake Ping - Agent-side Connection Verification
 *
 * Sends an initial handshake ping from NextLib-Agent to NextLib-Cloud
 * to verify connectivity and establish the "connected" status for the tenant.
 *
 * Flow:
 * 1. Reads cloud_base_url, api_secret, and tenant_id from config
 * 2. Constructs request body: {"action": "ping", "tenant_id": "<tenant_id>"}
 * 3. Generates HMAC-SHA256 token using the body and secret
 * 4. Sends POST request to {cloud_base_url}/api/v1/handshake with X-NextLib-Token header
 * 5. Returns success/failure status
 *
 * @package    NextLib-Agent
 * @subpackage Lib
 * @version    1.0.0
 * @requires   PHP 7.4+
 */

namespace NextLibAgent\Lib;

use NextLibAgent\Lib\HttpClient;

class HandshakePing
{
    /**
     * @var HttpClient HTTP client for cloud communication
     */
    private $httpClient;

    /**
     * @var array Configuration array (api_secret, cloud_base_url, tenant_id)
     */
    private $config;

    /**
     * @param HttpClient $httpClient HTTP client instance configured with cloud base URL
     * @param array      $config     Configuration array with api_secret, cloud_base_url, tenant_id
     */
    public function __construct(HttpClient $httpClient, array $config)
    {
        $this->httpClient = $httpClient;
        $this->config = $config;
    }

    /**
     * Send handshake ping to NextLib-Cloud.
     *
     * Constructs a JSON payload with action "ping" and the tenant_id,
     * signs it with HMAC-SHA256, and sends it to the cloud handshake endpoint.
     *
     * @return array Result with keys:
     *               - 'success' (bool): Whether the handshake was acknowledged
     *               - 'status' (int): HTTP status code from cloud (0 if connection failed)
     *               - 'message' (string): Descriptive message about the result
     *               - 'data' (array|null): Parsed response body on success
     */
    public function send(): array
    {
        $apiSecret = isset($this->config['api_secret']) ? $this->config['api_secret'] : '';
        if ($apiSecret === '') {
            return array(
                'success' => false,
                'status' => 0,
                'message' => 'API secret is not configured',
                'data' => null,
            );
        }

        $tenantId = isset($this->config['tenant_id']) ? $this->config['tenant_id'] : '';
        if ($tenantId === '') {
            return array(
                'success' => false,
                'status' => 0,
                'message' => 'Tenant ID is not configured',
                'data' => null,
            );
        }

        // Build request body
        $body = $this->buildRequestBody($tenantId);

        // Sign the request with HMAC-SHA256
        $signer = new HmacSigner($apiSecret);
        $token = $signer->generateToken($body);

        // Build headers
        $headers = array(
            'Content-Type: application/json',
            'X-NextLib-Token: ' . $token,
        );

        // Send POST request to /api/v1/handshake
        $response = $this->httpClient->post('/api/v1/handshake', $body, $headers);

        return $this->parseResponse($response);
    }

    /**
     * Build the JSON request body for the handshake ping.
     *
     * @param string $tenantId The tenant identifier
     * @return string JSON-encoded request body
     */
    public function buildRequestBody(string $tenantId): string
    {
        $payload = array(
            'action' => 'ping',
            'tenant_id' => $tenantId,
        );

        $json = json_encode($payload);

        // json_encode should not fail for simple arrays, but handle gracefully
        if ($json === false) {
            return '{"action":"ping","tenant_id":""}';
        }

        return $json;
    }

    /**
     * Parse the HTTP response from NextLib-Cloud handshake endpoint.
     *
     * @param array $response Response array from HttpClient::post()
     * @return array Parsed result with success, status, message, and data keys
     */
    private function parseResponse(array $response): array
    {
        $status = isset($response['status']) ? (int) $response['status'] : 0;
        $body = isset($response['body']) ? $response['body'] : '';
        $error = isset($response['error']) ? $response['error'] : null;

        // Connection error
        if ($error !== null) {
            return array(
                'success' => false,
                'status' => $status,
                'message' => 'Connection error: ' . $error,
                'data' => null,
            );
        }

        // Non-success HTTP status
        if ($status < 200 || $status >= 300) {
            $message = 'Handshake failed with HTTP status ' . $status;

            // Try to extract error message from response body
            $decoded = json_decode($body, true);
            if (is_array($decoded) && isset($decoded['message'])) {
                $message = $decoded['message'];
            }

            return array(
                'success' => false,
                'status' => $status,
                'message' => $message,
                'data' => $decoded,
            );
        }

        // Success - parse response body
        $decoded = json_decode($body, true);

        return array(
            'success' => true,
            'status' => $status,
            'message' => 'Handshake successful',
            'data' => is_array($decoded) ? $decoded : null,
        );
    }
}
