import { db } from "./db";
import { tenantAuditLogs } from "./db/schema";

const SECRET_FIELD_PATTERN = /secret|token|hash|key|password/i;

export type AuditAction = "field_update" | "regenerate_secret" | "test_connection";

export type AuditLogInput = {
  tenantId: string;
  actorUserId?: string | null;
  actorEmail: string;
  action: AuditAction;
  fieldName?: string;
  oldValue?: string | null;
  newValue?: string | null;
  metadata?: Record<string, unknown>;
};

/**
 * Returns the given value unchanged, unless `fieldName` matches a known
 * secret-like pattern (secret|token|hash|key|password, case-insensitive) —
 * in which case the value is replaced with the literal `[REDACTED]` to
 * prevent plaintext secrets from being written to the audit log.
 *
 * `null` / `undefined` values are passed through unchanged.
 *
 * The return type is widened to `string | null | undefined` (rather than
 * just `string`) so nullish inputs flow through without a cast — a cleaner
 * alternative to the `value as null | undefined as string` pattern.
 */
export function maskSecretValue(
  fieldName: string,
  value: string | null | undefined
): string | null | undefined {
  if (value == null) return value;
  if (SECRET_FIELD_PATTERN.test(fieldName)) return "[REDACTED]";
  return value;
}

export async function writeAuditLog(input: AuditLogInput): Promise<void> {
  // Use fieldName when present; otherwise fall back to the action. This
  // ensures secret actions like "regenerate_secret" trigger masking even
  // without an explicit fieldName — "regenerate_secret" itself matches the
  // secret pattern. Non-secret actions like "test_connection" or
  // "field_update" only get masked when a matching fieldName is supplied.
  const maskingKey = input.fieldName ?? input.action;
  const oldValue = maskSecretValue(maskingKey, input.oldValue) ?? null;
  const newValue = maskSecretValue(maskingKey, input.newValue) ?? null;

  await db.insert(tenantAuditLogs).values({
    tenantId: input.tenantId,
    actorUserId: input.actorUserId ?? null,
    actorEmail: input.actorEmail,
    action: input.action,
    fieldName: input.fieldName ?? null,
    oldValue,
    newValue,
    metadata: input.metadata ?? null,
  });
}
