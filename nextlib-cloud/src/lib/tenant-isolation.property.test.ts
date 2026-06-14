import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { withTenantScope } from './tenant-context'

/**
 * Property 3: Tenant Data Isolation
 *
 * For all queries executed by tenant A, results never contain records
 * with tenant_id belonging to tenant B.
 *
 * Formal: ∀ tenantA, tenantB where tenantA ≠ tenantB: query(tenantA).results ∩ records(tenantB) == ∅
 *
 * Since we cannot run real DB queries in property tests, we verify the isolation
 * logic: withTenantScope always binds to the correct tenantId and never produces
 * overlapping scopes for different tenants. We also verify the Drizzle filter
 * condition produced by tenantFilter() always targets the correct tenant_id column
 * and value.
 *
 * **Validates: Requirements 5.2, 5.5**
 */
describe('Property 3: Tenant Data Isolation', () => {
  /** UUID v4 arbitrary generator for tenant IDs */
  const uuidArb = fc.uuid().filter((id) => id.length > 0)

  /**
   * Helper to extract the bound value from a Drizzle eq() SQL filter.
   * Drizzle eq(column, value) produces queryChunks: [StringChunk, Column, StringChunk(' = '), Param(value), StringChunk]
   */
  function extractFilterValue(filter: unknown): unknown {
    const chunks = (filter as { queryChunks: unknown[] }).queryChunks
    // The Param chunk (index 3) holds the bound value
    const paramChunk = chunks[3] as { value: unknown }
    return paramChunk.value
  }

  /**
   * Helper to extract the column name from a Drizzle eq() SQL filter.
   */
  function extractFilterColumnName(filter: unknown): string {
    const chunks = (filter as { queryChunks: unknown[] }).queryChunks
    // The Column chunk (index 1) has a `name` property
    const columnChunk = chunks[1] as { name: string }
    return columnChunk.name
  }

  it('withTenantScope(tenantA).tenantId always equals tenantA', () => {
    fc.assert(
      fc.property(uuidArb, (tenantId) => {
        const scope = withTenantScope(tenantId)
        expect(scope.tenantId).toBe(tenantId)
      }),
      { numRuns: 200 }
    )
  })

  it('withTenantScope produces distinct scopes for distinct tenant IDs', () => {
    fc.assert(
      fc.property(
        uuidArb,
        uuidArb,
        (tenantA, tenantB) => {
          fc.pre(tenantA !== tenantB)

          const scopeA = withTenantScope(tenantA)
          const scopeB = withTenantScope(tenantB)

          // Scopes must be bound to different tenants
          expect(scopeA.tenantId).not.toBe(scopeB.tenantId)
          // Each scope is bound to its own tenant
          expect(scopeA.tenantId).toBe(tenantA)
          expect(scopeB.tenantId).toBe(tenantB)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('tenantFilter() produces a condition targeting the tenant_id column with the correct value', () => {
    fc.assert(
      fc.property(uuidArb, (tenantId) => {
        const scope = withTenantScope(tenantId)
        const filter = scope.tenantFilter()

        // Filter should be defined
        expect(filter).toBeDefined()
        expect(filter).not.toBeNull()

        // The filter targets the tenant_id column
        const columnName = extractFilterColumnName(filter)
        expect(columnName).toBe('tenant_id')

        // The filter binds to the exact tenantId value
        const boundValue = extractFilterValue(filter)
        expect(boundValue).toBe(tenantId)
      }),
      { numRuns: 200 }
    )
  })

  it('tenantFilter() for tenantA never binds to tenantB value', () => {
    fc.assert(
      fc.property(
        uuidArb,
        uuidArb,
        (tenantA, tenantB) => {
          fc.pre(tenantA !== tenantB)

          const scopeA = withTenantScope(tenantA)
          const filterA = scopeA.tenantFilter()

          // The filter for tenantA must bind to tenantA
          const boundValue = extractFilterValue(filterA)
          expect(boundValue).toBe(tenantA)

          // The filter for tenantA must NOT bind to tenantB
          expect(boundValue).not.toBe(tenantB)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('two tenant scopes are completely independent (no shared mutable state)', () => {
    fc.assert(
      fc.property(
        uuidArb,
        uuidArb,
        (tenantA, tenantB) => {
          fc.pre(tenantA !== tenantB)

          // Create scopes in sequence
          const scopeA = withTenantScope(tenantA)
          const scopeB = withTenantScope(tenantB)

          // Verify creating scopeB did not mutate scopeA
          expect(scopeA.tenantId).toBe(tenantA)
          expect(scopeB.tenantId).toBe(tenantB)

          // Verify filters remain independently bound to their respective tenants
          const filterA = scopeA.tenantFilter()
          const filterB = scopeB.tenantFilter()

          const valueA = extractFilterValue(filterA)
          const valueB = extractFilterValue(filterB)

          // Each filter only targets its own tenant
          expect(valueA).toBe(tenantA)
          expect(valueA).not.toBe(tenantB)
          expect(valueB).toBe(tenantB)
          expect(valueB).not.toBe(tenantA)
        }
      ),
      { numRuns: 200 }
    )
  })
})
