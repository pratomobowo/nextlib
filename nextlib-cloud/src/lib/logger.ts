/**
 * Logger utility with PII sanitization.
 *
 * All log output is automatically sanitized to mask sensitive fields,
 * ensuring PII never appears in server logs (Requirement 10.1, 10.2).
 */

/** Fields that contain general PII - masked to first 3 chars + "***" */
const PII_FIELDS = new Set([
  'name',
  'email',
  'phone',
  'member_id',
  'nim',
  'address',
  'member_name',
])

/** Fields that contain secrets/tokens - masked to first 8 chars + "..." */
const SECRET_FIELDS = new Set([
  'api_secret',
  'token',
])

/**
 * Mask a PII string value: show first 3 chars + "***"
 * For values shorter than 3 chars, show what's available + "***"
 */
function maskPii(value: string): string {
  if (value.length <= 3) {
    return value + '***'
  }
  return value.slice(0, 3) + '***'
}

/**
 * Mask a secret/token value: show first 8 chars + "..."
 * For values shorter than 8 chars, show what's available + "..."
 */
function maskSecret(value: string): string {
  if (value.length <= 8) {
    return value + '...'
  }
  return value.slice(0, 8) + '...'
}

/**
 * Recursively sanitize data by masking PII and secret fields.
 *
 * - Fields matching PII_FIELDS have their string values masked to first 3 chars + "***"
 * - Fields matching SECRET_FIELDS have their string values masked to first 8 chars + "..."
 * - Arrays are recursed into
 * - Nested objects are recursed into
 * - Non-string values in PII/secret fields are replaced with "[REDACTED]"
 * - Primitives and other types pass through unchanged
 */
export function sanitizeForLog(data: unknown): unknown {
  if (data === null || data === undefined) {
    return data
  }

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeForLog(item))
  }

  if (typeof data === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      const lowerKey = key.toLowerCase()

      if (PII_FIELDS.has(lowerKey)) {
        if (typeof value === 'string') {
          result[key] = maskPii(value)
        } else if (value !== null && value !== undefined) {
          result[key] = '[REDACTED]'
        } else {
          result[key] = value
        }
      } else if (SECRET_FIELDS.has(lowerKey)) {
        if (typeof value === 'string') {
          result[key] = maskSecret(value)
        } else if (value !== null && value !== undefined) {
          result[key] = '[REDACTED]'
        } else {
          result[key] = value
        }
      } else if (typeof value === 'object' && value !== null) {
        result[key] = sanitizeForLog(value)
      } else {
        result[key] = value
      }
    }
    return result
  }

  return data
}

/**
 * Logger with auto-sanitization of PII fields.
 *
 * Usage:
 *   logger.info('Tenant registered', { name: 'John Doe', email: 'john@uni.ac.id' })
 *   // Output: Tenant registered { name: 'Joh***', email: 'joh***' }
 */
export const logger = {
  info(message: string, ...args: unknown[]): void {
    const sanitizedArgs = args.map((arg) => sanitizeForLog(arg))
    console.info(`[INFO] ${message}`, ...sanitizedArgs)
  },

  warn(message: string, ...args: unknown[]): void {
    const sanitizedArgs = args.map((arg) => sanitizeForLog(arg))
    console.warn(`[WARN] ${message}`, ...sanitizedArgs)
  },

  error(message: string, ...args: unknown[]): void {
    const sanitizedArgs = args.map((arg) => sanitizeForLog(arg))
    console.error(`[ERROR] ${message}`, ...sanitizedArgs)
  },
}
