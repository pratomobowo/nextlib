<?php
/**
 * Route Registration Tests
 *
 * Verifies that the /v1/nextlib/daily-aggregate route is properly wired up:
 *   - the Plugin class defines a public handleDailyAggregate() handler with
 *     the conventional signature used by the rest of the handlers
 *     (e.g. handleHealth, handleTopBooks, handleMemberActivity)
 *   - the handler is wrapped in $this->withHmac(...) to enforce HMAC/Ed25519
 *     authentication, matching every other data endpoint in the file —
 *     this is a security-critical guard so unauthenticated callers cannot
 *     read daily visitor/loan/member/biblio/item counts or collection stats
 *   - body parsing delegates to the centralized $this->parseBody() helper
 *     inside the withHmac callback instead of inlining json_decode, matching
 *     the convention set by handleTopBooks/handleMemberActivity
 *
 * Pure reflection-based test — no SLiMS runtime, no DB, no HTTP transport.
 * The Plugin file is loaded explicitly via require_once in setUp() to make
 * the test independent of the Composer autoloader order.
 *
 * @package NextLib\Agent\Tests
 */

namespace NextLib\Agent\Tests;

use PHPUnit\Framework\TestCase;
use ReflectionClass;

class RouteRegistrationTest extends TestCase
{
    protected function setUp(): void
    {
        // Explicit require_once — defensive: the Composer autoloader should
        // already map NextLibAgent\Plugin to lib/Plugin.php via PSR-4, but
        // loading the file directly here guarantees the class is available
        // regardless of bootstrap order and is a no-op if already loaded.
        require_once __DIR__ . '/../../lib/Plugin.php';
    }

    /**
     * handleDailyAggregate() must exist on NextLibAgent\Plugin and match the
     * `(array $params = [])` signature used by every other handler so the
     * SLiMS Router can dispatch to it positionally without per-route config.
     */
    public function testHandleDailyAggregateHasCorrectSignature(): void
    {
        $this->assertTrue(
            class_exists(\NextLibAgent\Plugin::class),
            'NextLibAgent\\Plugin class must be loadable for route registration tests'
        );

        $reflection = new ReflectionClass(\NextLibAgent\Plugin::class);
        $this->assertTrue(
            $reflection->hasMethod('handleDailyAggregate'),
            'NextLibAgent\\Plugin must define handleDailyAggregate() to back the /v1/nextlib/daily-aggregate route'
        );

        $method = $reflection->getMethod('handleDailyAggregate');

        $this->assertTrue(
            $method->isPublic(),
            'handleDailyAggregate() must be public so the SLiMS Router can invoke it'
        );

        $parameters = $method->getParameters();
        $this->assertCount(
            1,
            $parameters,
            'handleDailyAggregate() must accept exactly one parameter, matching handleHealth/handleTopBooks/handleMemberActivity'
        );

        $this->assertSame(
            'params',
            $parameters[0]->getName(),
            'Parameter must be named "params" to match the rest of the handler family'
        );

        $this->assertTrue(
            $parameters[0]->isDefaultValueAvailable(),
            'Parameter must have a default value (e.g. $params = []) so the Router can call the method positionally'
        );
    }

    /**
     * handleDailyAggregate() must be wrapped in $this->withHmac(...) so the
     * endpoint enforces HMAC + timestamp + tenant authentication, matching
     * every other data endpoint in Plugin.php. Without this wrapper the
     * handler exposes visitor counts, loan/return counts, member/biblio/item
     * counts, collection size, and active-member counts for any date range
     * to any unauthenticated caller that can reach the SLiMS server.
     */
    public function testHandleDailyAggregateRequiresHmacAuth(): void
    {
        $reflection = new ReflectionClass(\NextLibAgent\Plugin::class);
        $method = $reflection->getMethod('handleDailyAggregate');

        $filename = $method->getFileName();
        $this->assertNotFalse(
            $filename,
            'Reflection must be able to locate the source file for handleDailyAggregate()'
        );

        $source = file($filename);
        $this->assertNotFalse(
            $source,
            "Source file '{$filename}' must be readable for reflection-based body inspection"
        );

        $start = $method->getStartLine();
        $end = $method->getEndLine();
        $methodBody = implode('', array_slice($source, $start - 1, $end - $start + 1));

        $this->assertStringContainsString(
            '$this->withHmac(',
            $methodBody,
            'handleDailyAggregate() must be wrapped in $this->withHmac(...) to enforce '
            . 'HMAC + Ed25519 authentication, matching handleTopBooks/handleMemberActivity — '
            . 'without it, the endpoint leaks daily aggregate stats to unauthenticated callers'
        );
    }

    /**
     * handleDailyAggregate() must use the $this->parseBody() helper inside the
     * withHmac callback instead of inlining json_decode. This keeps a single
     * place to evolve body-parsing behavior and matches the convention set by
     * handleTopBooks()/handleMemberActivity() and the rest of the handler family.
     */
    public function testHandleDailyAggregateUsesParseBodyHelper(): void
    {
        $reflection = new ReflectionClass(\NextLibAgent\Plugin::class);
        $method = $reflection->getMethod('handleDailyAggregate');

        $filename = $method->getFileName();
        $this->assertNotFalse(
            $filename,
            'Reflection must be able to locate the source file for handleDailyAggregate()'
        );

        $source = file($filename);
        $this->assertNotFalse(
            $source,
            "Source file '{$filename}' must be readable for reflection-based body inspection"
        );

        $start = $method->getStartLine();
        $end = $method->getEndLine();
        $methodBody = implode('', array_slice($source, $start - 1, $end - $start + 1));

        $this->assertStringContainsString(
            '$this->parseBody(',
            $methodBody,
            'handleDailyAggregate() must use $this->parseBody() inside the withHmac callback '
            . 'for body parsing — do not inline json_decode or reimplement file_get_contents(\'php://input\')'
        );
    }

    /**
     * The /v1/nextlib/daily-aggregate route must be registered in
     * nextlib-agent.plugin.php. The Plugin class defining handleDailyAggregate()
     * is not enough on its own — the SLiMS Router is only wired up if the route
     * string is registered against the handler. This catches regressions where
     * someone removes the route registration while leaving the handler in place.
     */
    public function testDailyAggregateRouteIsRegisteredInPluginFile(): void
    {
        $pluginFile = __DIR__ . '/../../nextlib-agent.plugin.php';
        $contents = file_get_contents($pluginFile);
        $this->assertNotFalse(
            $contents,
            "Plugin file '{$pluginFile}' must be readable for route registration inspection"
        );

        $this->assertStringContainsString(
            "'/v1/nextlib/daily-aggregate'",
            $contents,
            "daily-aggregate route must be registered in nextlib-agent.plugin.php"
        );
    }
}
