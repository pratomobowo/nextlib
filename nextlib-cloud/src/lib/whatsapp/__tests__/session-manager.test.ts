import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSelect, mockInsert, mockUpdate, mockLimit, mockLogout, mockLogin } = vi.hoisted(() => {
  const limit = vi.fn();
  const select = vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({ limit }),
    }),
  });
  
  const insert = vi.fn().mockReturnValue({
    values: vi.fn().mockResolvedValue(null),
  });

  const returning = vi.fn().mockResolvedValue([]);
  const update = vi.fn().mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning,
      }),
    }),
  });

  const login = vi.fn();
  const logout = vi.fn();

  return {
    mockSelect: select,
    mockInsert: insert,
    mockUpdate: update,
    mockLimit: limit,
    mockLogout: logout,
    mockLogin: login,
  };
});

vi.mock("@/lib/db", () => ({
  db: {
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
  },
}));

vi.mock("@/lib/db/schema", () => ({
  whatsappSessions: {
    id: "id",
    tenantId: "tenant_id",
    status: "status",
    phoneNumber: "phone_number",
    deviceId: "device_id",
    connectedAt: "connected_at",
    disconnectedAt: "disconnected_at",
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
}));

vi.mock("../gowa-client", () => {
  return {
    GowaClient: class {
      login = mockLogin;
      logout = mockLogout;
    },
    GowaApiError: class extends Error {},
  };
});

import { SessionManager } from "../session-manager";

describe("SessionManager", () => {
  let manager: SessionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new SessionManager();
  });

  describe("initSession", () => {
    it("successfully initializes a new session when none exists", async () => {
      mockLimit.mockResolvedValueOnce([]); // No existing session
      mockLogin.mockResolvedValueOnce({
        code: 200,
        message: "Success",
        results: { qr_link: "base64_qr", qr_duration: 30 },
      });

      const res = await manager.initSession("tenant-1");

      expect(mockSelect).toHaveBeenCalledTimes(1);
      expect(mockLogin).toHaveBeenCalledWith("tenant-1");
      expect(mockInsert).toHaveBeenCalledTimes(1);
      expect(res.qrLink).toBe("base64_qr");
      expect(res.qrDuration).toBe(30);
    });

    it("throws an error if a session is already connected", async () => {
      mockLimit.mockResolvedValueOnce([{ status: "connected", tenantId: "tenant-1" }]);

      await expect(manager.initSession("tenant-1")).rejects.toThrow(
        "Tenant sudah memiliki sesi WhatsApp yang aktif"
      );
      expect(mockLogin).not.toHaveBeenCalled();
      expect(mockInsert).not.toHaveBeenCalled();
    });
  });

  describe("disconnectSession", () => {
    it("successfully disconnects a connected session", async () => {
      mockLimit.mockResolvedValueOnce([{ status: "connected", tenantId: "tenant-1" }]);
      mockLogout.mockResolvedValueOnce({ code: 200, message: "Logged out" });

      await manager.disconnectSession("tenant-1");

      expect(mockLogout).toHaveBeenCalledWith("tenant-1");
      expect(mockUpdate).toHaveBeenCalledTimes(1);
    });
  });
});
