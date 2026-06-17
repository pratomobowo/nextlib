<?php
/**
 * Integration tests for the full TokenValidator → Ed25519Verifier chain with
 * realistic config. These guard against the class of bug where individual
 * components work in isolation but the wiring is wrong (e.g., Plugin.php
 * passing the wrong key to TokenValidator::handle, or getallheaders() not
 * being available in non-Apache SAPIs).
 */

namespace NextLib\Agent\Tests\Middleware;

use PHPUnit\Framework\TestCase;
use NextLibAgent\Middleware\TokenValidator;

final class TokenValidatorIntegrationTest extends TestCase
{
    private array $originalServer;

    protected function setUp(): void
    {
        $this->originalServer = $_SERVER;
    }

    protected function tearDown(): void
    {
        $_SERVER = $this->originalServer;
    }

    public function testEndToEndEd25519RequestWithCorrectKeySucceeds(): void
    {
        // Generate a real keypair — this IS the SaaS-side keypair
        $kp = sodium_crypto_sign_keypair();
        $publicKeyB64 = base64_encode(sodium_crypto_sign_publickey($kp));
        $secretKey = sodium_crypto_sign_secretkey($kp);

        // Sign a request as SaaS would
        $ts = (string) time();
        $path = '/api/v1/nextlib/health';
        $body = '';
        $message = "{$ts}.GET.{$path}.{$body}";
        $sig = sodium_crypto_sign_detached($message, $secretKey);
        $sigB64 = base64_encode($sig);

        // Simulate the request environment
        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_SERVER['REQUEST_URI'] = $path;
        $_SERVER['HTTP_X_NEXTLIB_TIMESTAMP'] = $ts;
        $_SERVER['HTTP_X_NEXTLIB_SIGNATURE'] = $sigB64;

        $callbackReceivedBody = null;
        $callbackReturn = ['status' => 'healthy', 'database' => ['connected' => true]];

        ob_start();
        TokenValidator::handle(
            $publicKeyB64,         // ed25519PublicKey (correct — would be from .env)
            'unused-hmac-secret',  // hmacSecret (would be from .env, not used here)
            function ($b) use (&$callbackReceivedBody, $callbackReturn) {
                $callbackReceivedBody = $b;
                return $callbackReturn;
            },
            300
        );
        $output = ob_get_clean();

        $this->assertSame('', $callbackReceivedBody, 'Callback should receive the request body');
        $decoded = json_decode($output, true);
        $this->assertSame($callbackReturn, $decoded, 'Output JSON should match callback return');
    }

    public function testEndToEndEd25519RequestWithWrongKeyFails401(): void
    {
        // Generate keypair A for signing, keypair B for verification
        $signingKp = sodium_crypto_sign_keypair();
        $verifyingKp = sodium_crypto_sign_keypair();
        $wrongPublicKeyB64 = base64_encode(sodium_crypto_sign_publickey($verifyingKp));

        $ts = (string) time();
        $path = '/api/v1/nextlib/health';
        $body = '';
        $message = "{$ts}.GET.{$path}.{$body}";
        $sig = sodium_crypto_sign_detached($message, sodium_crypto_sign_secretkey($signingKp));

        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_SERVER['REQUEST_URI'] = $path;
        $_SERVER['HTTP_X_NEXTLIB_TIMESTAMP'] = $ts;
        $_SERVER['HTTP_X_NEXTLIB_SIGNATURE'] = base64_encode($sig);

        $callbackInvoked = false;

        ob_start();
        TokenValidator::handle(
            $wrongPublicKeyB64,    // WRONG public key
            'unused-hmac-secret',
            function ($b) use (&$callbackInvoked) {
                $callbackInvoked = true;
                return ['ok' => true];
            },
            300
        );
        $output = ob_get_clean();

        $this->assertFalse($callbackInvoked, 'Callback must NOT run when signature is invalid');
        $decoded = json_decode($output, true);
        $this->assertSame('INVALID_SIGNATURE', $decoded['code']);
    }

    public function testPassingHmacSecretAsEd25519KeyFails401(): void
    {
        // Reproduces the critical bug from the Ed25519 rollout: Plugin.php used
        // to pass api_secret (HMAC secret, 64 hex chars) as the Ed25519 public
        // key. Ed25519Verifier expects a 32-byte raw key, so the length check
        // must reject the wrong-size key with 401 INVALID_SIGNATURE.
        $hmacSecret = str_repeat('a', 64);
        $ts = (string) time();

        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_SERVER['REQUEST_URI'] = '/api/v1/nextlib/health';
        $_SERVER['HTTP_X_NEXTLIB_TIMESTAMP'] = $ts;
        $_SERVER['HTTP_X_NEXTLIB_SIGNATURE'] = base64_encode(str_repeat("\0", 64));

        $callbackInvoked = false;

        ob_start();
        TokenValidator::handle(
            $hmacSecret,            // Wrong: passing HMAC secret as Ed25519 key
            'unused-hmac-secret',
            function ($b) use (&$callbackInvoked) {
                $callbackInvoked = true;
                return ['ok' => true];
            },
            300
        );
        $output = ob_get_clean();

        $this->assertFalse($callbackInvoked, 'Callback must NOT run when key size is invalid');
        $decoded = json_decode($output, true);
        $this->assertSame('INVALID_SIGNATURE', $decoded['code']);
    }

    public function testExpiredTimestampFails401(): void
    {
        $kp = sodium_crypto_sign_keypair();
        $publicKeyB64 = base64_encode(sodium_crypto_sign_publickey($kp));

        $ts = (string) (time() - 1000);  // 1000s ago, well outside 300s window
        $path = '/api/v1/nextlib/health';
        $message = "{$ts}.GET.{$path}.";
        $sig = sodium_crypto_sign_detached($message, sodium_crypto_sign_secretkey($kp));

        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_SERVER['REQUEST_URI'] = $path;
        $_SERVER['HTTP_X_NEXTLIB_TIMESTAMP'] = $ts;
        $_SERVER['HTTP_X_NEXTLIB_SIGNATURE'] = base64_encode($sig);

        ob_start();
        TokenValidator::handle(
            $publicKeyB64,
            'unused',
            function ($b) { return ['ok' => true]; },
            300
        );
        $output = ob_get_clean();

        $decoded = json_decode($output, true);
        $this->assertSame('INVALID_SIGNATURE', $decoded['code']);
    }

    public function testMissingBothAuthSchemesReturns401MissingAuth(): void
    {
        $kp = sodium_crypto_sign_keypair();
        $publicKeyB64 = base64_encode(sodium_crypto_sign_publickey($kp));
        $hmacSecret = 'any-shared-secret';

        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_SERVER['REQUEST_URI'] = '/api/v1/nextlib/health';
        // No headers at all

        ob_start();
        TokenValidator::handle(
            $publicKeyB64,
            $hmacSecret,
            function ($b) { return ['ok' => true]; },
            300
        );
        $output = ob_get_clean();

        $decoded = json_decode($output, true);
        $this->assertSame('MISSING_AUTH', $decoded['code']);
    }
}

