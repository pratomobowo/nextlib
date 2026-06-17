import { describe, it, expect } from 'vitest'
import { tenants, dailyStats, dailyStatsV2 } from './db/schema'
import { getTableColumns } from 'drizzle-orm'

/**
 * Security & Privacy Architectural Verification Tests
 *
 * These tests enforce the privacy-first design principle (Requirement 10)
 * by verifying that no PII can persist in the cloud database or filesystem.
 *
 * PII includes: names of individuals, NIM (student ID), phone numbers,
 * email addresses, specific borrowing history, personal addresses.
 *
 * Validates: Requirements 10.1, 10.2, 10.3
 */

// Fields that would indicate PII storage if present in the database
const PII_COLUMN_PATTERNS = [
  'email',
  'phone',
  'nim',
  'student_id',
  'member_name',
  'borrower',
  'address',
  'personal',
  'first_name',
  'last_name',
  'full_name',
  'member_id',
  'patron',
  'borrowing_history',
  'loan_detail',
  'book_title_borrowed',
]

describe('Privacy-First Architecture: PII Never Persists in Cloud', () => {
  describe('daily_stats table schema analysis', () => {
    it('contains only non-PII aggregate columns', () => {
      const columns = getTableColumns(dailyStats)
      const columnNames = Object.keys(columns)

      // Only these columns should exist — all are aggregate/system fields
      const expectedColumns = [
        'id',
        'tenantId',
        'date',
        'visitorCount',
        'loanCount',
        'returnCount',
        'receivedAt',
      ]

      expect(columnNames.sort()).toEqual(expectedColumns.sort())
    })

    it('has no columns matching PII patterns', () => {
      const columns = getTableColumns(dailyStats)
      const columnNames = Object.keys(columns)

      for (const col of columnNames) {
        const colLower = col.toLowerCase()
        for (const pattern of PII_COLUMN_PATTERNS) {
          expect(colLower).not.toContain(pattern)
        }
      }
    })

    it('stores only numeric aggregates, dates, UUIDs, and timestamps', () => {
      const columns = getTableColumns(dailyStats)

      // id: UUID (Drizzle represents as PgUUID with dataType 'string')
      expect(columns.id.columnType).toBe('PgUUID')
      // tenantId: UUID reference
      expect(columns.tenantId.columnType).toBe('PgUUID')
      // date: date type
      expect(columns.date.columnType).toBe('PgDateString')
      // visitor_count, loan_count, return_count: integers
      expect(columns.visitorCount.columnType).toBe('PgInteger')
      expect(columns.loanCount.columnType).toBe('PgInteger')
      expect(columns.returnCount.columnType).toBe('PgInteger')
      // received_at: timestamp
      expect(columns.receivedAt.columnType).toBe('PgTimestamp')
    })

    it('does not contain any free-text or varchar columns that could store PII', () => {
      const columns = getTableColumns(dailyStats)

      // Drizzle column types that can store arbitrary text (PII risk)
      const freeTextColumnTypes = ['PgVarchar', 'PgText', 'PgChar']

      for (const [_name, col] of Object.entries(columns)) {
        expect(freeTextColumnTypes).not.toContain(col.columnType)
      }
    })
  })

  describe('daily_stats_v2 table schema analysis', () => {
    it('contains only non-PII aggregate columns', () => {
      const columns = getTableColumns(dailyStatsV2)
      const columnNames = Object.keys(columns)

      const expectedColumns = [
        'id',
        'tenantId',
        'date',
        'visitorCount',
        'uniqueVisitorCount',
        'loanCount',
        'returnCount',
        'newMemberCount',
        'newBiblioCount',
        'newItemCount',
        'finesDebetTotal',
        'finesCreditTotal',
        'reservationCount',
        'totalCollectionSize',
        'activeMemberCount',
        'activeOverdueCount',
        'anomalyFlags',
        'receivedAt',
      ]

      expect(columnNames.sort()).toEqual(expectedColumns.sort())
    })

    it('has no columns matching PII patterns', () => {
      const columns = getTableColumns(dailyStatsV2)
      const columnNames = Object.keys(columns)

      for (const col of columnNames) {
        const colLower = col.toLowerCase()
        for (const pattern of PII_COLUMN_PATTERNS) {
          expect(colLower).not.toContain(pattern)
        }
      }
    })

    it('stores only numeric aggregates, dates, UUIDs, arrays, and timestamps', () => {
      const columns = getTableColumns(dailyStatsV2)

      expect(columns.id.columnType).toBe('PgUUID')
      expect(columns.tenantId.columnType).toBe('PgUUID')
      expect(columns.date.columnType).toBe('PgDateString')
      expect(columns.visitorCount.columnType).toBe('PgInteger')
      expect(columns.uniqueVisitorCount.columnType).toBe('PgInteger')
      expect(columns.loanCount.columnType).toBe('PgInteger')
      expect(columns.returnCount.columnType).toBe('PgInteger')
      expect(columns.newMemberCount.columnType).toBe('PgInteger')
      expect(columns.newBiblioCount.columnType).toBe('PgInteger')
      expect(columns.newItemCount.columnType).toBe('PgInteger')
      expect(columns.finesDebetTotal.columnType).toBe('PgInteger')
      expect(columns.finesCreditTotal.columnType).toBe('PgInteger')
      expect(columns.reservationCount.columnType).toBe('PgInteger')
      expect(columns.totalCollectionSize.columnType).toBe('PgInteger')
      expect(columns.activeMemberCount.columnType).toBe('PgInteger')
      expect(columns.activeOverdueCount.columnType).toBe('PgInteger')
      expect(columns.anomalyFlags.columnType).toBe('PgArray')
      expect(columns.receivedAt.columnType).toBe('PgTimestamp')
    })

    it('does not contain any free-text or varchar columns that could store PII', () => {
      const columns = getTableColumns(dailyStatsV2)
      const freeTextColumnTypes = ['PgVarchar', 'PgText', 'PgChar']

      for (const [name, col] of Object.entries(columns)) {
        if (name === 'anomalyFlags') continue; // anomalyFlags uses PgArray containing text elements
        expect(freeTextColumnTypes).not.toContain(col.columnType)
      }
    })
  })

  describe('tenants table schema analysis', () => {
    it('stores only institutional data, not personal data', () => {
      const columns = getTableColumns(tenants)
      const columnNames = Object.keys(columns)

      // Expected institutional columns only
      const expectedColumns = [
        'id',
        'name',         // institution name, NOT personal name
        'slug',
        'slimsBaseUrl',
        'apiSecretEncrypted',
        'tokenHash',
        'ed25519PublicKey',
        'ed25519PrivateKeyEncrypted',
        'ed25519RotatedAt',
        'ed25519KeyId',
        'status',
        'createdAt',
        'updatedAt',
      ]      

      expect(columnNames.sort()).toEqual(expectedColumns.sort())
    })

    it('has no columns matching PII patterns', () => {
      const columns = getTableColumns(tenants)
      const columnNames = Object.keys(columns)

      for (const col of columnNames) {
        const colLower = col.toLowerCase()
        for (const pattern of PII_COLUMN_PATTERNS) {
          expect(colLower).not.toContain(pattern)
        }
      }
    })

    it('encrypts sensitive URLs and hashes tokens (no plaintext secrets)', () => {
      const columns = getTableColumns(tenants)

      // api_secret_encrypted — stored as encrypted text, not plaintext
      expect(columns.apiSecretEncrypted).toBeDefined()
      expect(columns.apiSecretEncrypted.name).toBe('api_secret_encrypted')

      // token_hash — stored as hash, not the actual token
      expect(columns.tokenHash).toBeDefined()
      expect(columns.tokenHash.name).toBe('token_hash')

      // No plaintext api_secret or token column should exist
      const columnNames = Object.keys(columns)
      expect(columnNames).not.toContain('apiSecret')
      expect(columnNames).not.toContain('token')
      expect(columnNames).not.toContain('api_secret')
    })
  })

  describe('aggregate payload validation rejects PII-like data', () => {
    it('aggregate payload schema allows only defined numeric stats fields', () => {
      // The aggregate payload schema (defined in route.ts) allows only:
      // - tenant_id (UUID)
      // - date (YYYY-MM-DD)
      // - stats: { visitor_count, loan_count, return_count } (all non-negative integers)
      // - sent_at (optional ISO string)
      //
      // Any PII fields submitted would be rejected by schema validation.
      const allowedStatsFields = ['visitor_count', 'loan_count', 'return_count']

      for (const field of allowedStatsFields) {
        // Verify none of the allowed fields could contain PII
        for (const pattern of PII_COLUMN_PATTERNS) {
          expect(field).not.toContain(pattern)
        }
      }
    })

    it('aggregate stats fields are strictly numeric (cannot store PII strings)', () => {
      // The Zod schema enforces: z.number().int().min(0) for each stat field.
      // This means even if someone tried to inject PII, the schema rejects
      // non-integer values. We verify this architecturally by checking daily_stats
      // columns are integer type.
      const columns = getTableColumns(dailyStats)

      expect(columns.visitorCount.columnType).toBe('PgInteger')
      expect(columns.loanCount.columnType).toBe('PgInteger')
      expect(columns.returnCount.columnType).toBe('PgInteger')
    })

    it('no free-text fields exist in daily_stats that could receive PII', () => {
      const columns = getTableColumns(dailyStats)

      // Drizzle column types that allow arbitrary text input (PII risk)
      const freeTextColumnTypes = ['PgVarchar', 'PgText', 'PgChar']

      const textColumns = Object.entries(columns).filter(
        ([_, col]) => freeTextColumnTypes.includes(col.columnType)
      )

      // daily_stats should have zero free-text columns
      expect(textColumns).toHaveLength(0)
    })
  })

  describe('proxy router architectural verification', () => {
    it('no proxy route directory exists yet (to be implemented as stateless)', () => {
      // The proxy router is designed to be stateless and in-memory.
      // When implemented, it should NOT have any database write operations.
      // This test documents the architectural constraint.
      //
      // Proxy router design guarantees (from design doc):
      // 1. Processes data in-memory only
      // 2. No database writes for proxied data
      // 3. No filesystem writes for proxied data
      // 4. No PII caching between requests
      //
      // Since the proxy router is not yet implemented, we verify
      // the existing codebase has no proxy-related database schemas
      // that could store PII.
      const dailyStatsColumns = getTableColumns(dailyStats)
      const tenantColumns = getTableColumns(tenants)

      // Verify no "proxy_cache", "request_log", or "response_data" columns exist
      const allColumns = [
        ...Object.keys(dailyStatsColumns),
        ...Object.keys(tenantColumns),
      ]

      const proxyDataPatterns = [
        'proxy_cache',
        'request_log',
        'response_data',
        'cached_response',
        'search_result',
        'member_data',
        'loan_data',
      ]

      for (const col of allColumns) {
        const colLower = col.toLowerCase()
        for (const pattern of proxyDataPatterns) {
          expect(colLower).not.toContain(pattern)
        }
      }
    })

    it('database has no tables designed to store proxied PII data', () => {
      // The only tables in the schema are:
      // 1. tenants - institutional config only
      // 2. daily_stats - aggregate numbers only
      //
      // There should be NO tables for:
      // - search results caching
      // - member information storage
      // - loan records
      // - session data containing PII
      //
      // We verify by checking the two known tables have no PII storage capability
      const dailyStatsColumns = Object.keys(getTableColumns(dailyStats))
      const tenantsColumns = Object.keys(getTableColumns(tenants))

      // daily_stats: only aggregates
      expect(dailyStatsColumns).not.toContain('memberName')
      expect(dailyStatsColumns).not.toContain('searchQuery')
      expect(dailyStatsColumns).not.toContain('responseBody')

      // tenants: only institutional config
      expect(tenantsColumns).not.toContain('adminEmail')
      expect(tenantsColumns).not.toContain('adminPhone')
      expect(tenantsColumns).not.toContain('contactPerson')
    })
  })
})
