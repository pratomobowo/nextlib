import { describe, it, expect, vi } from "vitest";
import { maskSecretValue, writeAuditLog } from "./tenant-audit";

// `vi.mock` factories are hoisted above imports, so any module-level state
// they reference must be defined via `vi.hoisted` (also hoisted). Plain
// `const` declarations at module scope are not yet initialized when the mock
// factory runs.
const { insertMock } = vi.hoisted(() => ({
  insertMock: vi.fn(),
}));

// Drizzle's query builder is chainable: `db.insert(table).values(data)`.
// The mock has to return a builder-like object with a `.values()` method
// that captures the data; the test asserts on what was passed to `.values()`.
vi.mock("@/lib/db", () => ({
  db: {
    insert: () => ({
      values: (v: unknown) => insertMock(v),
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  tenantAuditLogs: { __table: "tenant_audit_logs" },
}));

describe("maskSecretValue", () => {
  it.each([
    "apiSecret",
    "api_secret",
    "apiToken",
    "tokenHash",
    "password",
    "secret_key",
  ])("redacts field name '%s'", (field) => {
    expect(maskSecretValue(field, "abc123")).toBe("[REDACTED]");
  });

  it.each(["name", "status", "slimsBaseUrl", "slims_base_url"])(
    "does NOT redact field name '%s'",
    (field) => {
      expect(maskSecretValue(field, "Universitas NextLib")).toBe("Universitas NextLib");
    }
  );
});

describe("writeAuditLog", () => {
  it("calls db.insert with masked values for secret fields", async () => {
    insertMock.mockResolvedValue([]);
    await writeAuditLog({
      tenantId: "t1",
      actorUserId: "u1",
      actorEmail: "admin@x.com",
      action: "regenerate_secret",
      oldValue: "old-token-value",
      newValue: "new-token-value",
      metadata: { ip: "1.2.3.4" },
    });
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "t1",
        actorEmail: "admin@x.com",
        action: "regenerate_secret",
        oldValue: "[REDACTED]",
        newValue: "[REDACTED]",
        metadata: { ip: "1.2.3.4" },
      })
    );
  });

  it("does NOT mask non-secret field updates", async () => {
    insertMock.mockResolvedValue([]);
    await writeAuditLog({
      tenantId: "t1",
      actorEmail: "a@x",
      action: "field_update",
      fieldName: "name",
      oldValue: "Old Name",
      newValue: "New Name",
    });
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        fieldName: "name",
        oldValue: "Old Name",
        newValue: "New Name",
      })
    );
  });
});
