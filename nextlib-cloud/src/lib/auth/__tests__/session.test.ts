import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockSelect,
  mockInsert,
  mockDelete,
  mockSetCookie,
  mockGetCookie,
  mockDeleteCookie,
  mockInnerJoin,
  mockFrom,
  mockWhere,
  mockLimit,
  mockReturning,
} = vi.hoisted(() => {
  const returning = vi.fn();
  const limit = vi.fn();
  const where = vi.fn().mockReturnValue({ limit });
  const innerJoin = vi.fn().mockReturnValue({ where });
  const from = vi.fn().mockReturnValue({ innerJoin });
  
  const select = vi.fn().mockReturnValue({
    from,
  });

  const insert = vi.fn().mockReturnValue({
    values: vi.fn().mockReturnValue({
      returning,
    }),
  });

  const dbDelete = vi.fn().mockReturnValue({
    where: vi.fn().mockResolvedValue(null),
  });

  const setCookie = vi.fn();
  const getCookie = vi.fn();
  const deleteCookie = vi.fn();

  return {
    mockSelect: select,
    mockInsert: insert,
    mockDelete: dbDelete,
    mockSetCookie: setCookie,
    mockGetCookie: getCookie,
    mockDeleteCookie: deleteCookie,
    mockInnerJoin: innerJoin,
    mockFrom: from,
    mockWhere: where,
    mockLimit: limit,
    mockReturning: returning,
  };
});

vi.mock("@/lib/db", () => ({
  db: {
    select: mockSelect,
    insert: mockInsert,
    delete: mockDelete,
  },
}));

vi.mock("@/lib/db/schema", () => ({
  sessions: {
    id: "session_id",
    userId: "user_id",
    expiresAt: "expires_at",
    createdAt: "created_at",
  },
  users: {
    id: "user_id",
    email: "email",
    passwordHash: "password_hash",
    name: "name",
    role: "role",
    tenantId: "tenant_id",
  },
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    set: mockSetCookie,
    get: mockGetCookie,
    delete: mockDeleteCookie,
  }),
}));

import { createSession, getSessionUser, destroySession } from "../session";

describe("Session Auth Helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createSession", () => {
    it("successfully creates a database session and sets the cookie", async () => {
      const mockSessionId = "session-1234-uuid";
      mockReturning.mockResolvedValueOnce([{ id: mockSessionId }]);

      const token = await createSession("user-1");

      expect(mockInsert).toHaveBeenCalledTimes(1);
      expect(mockReturning).toHaveBeenCalledTimes(1);
      expect(token).toBe(mockSessionId);

      expect(mockSetCookie).toHaveBeenCalledWith(
        "nextlib_session",
        mockSessionId,
        expect.objectContaining({
          httpOnly: true,
          path: "/",
        })
      );
    });
  });

  describe("getSessionUser", () => {
    it("returns null if no session cookie exists", async () => {
      mockGetCookie.mockReturnValueOnce(undefined);

      const result = await getSessionUser();

      expect(result).toBeNull();
      expect(mockSelect).not.toHaveBeenCalled();
    });

    it("returns user and session if a valid session exists in DB", async () => {
      mockGetCookie.mockReturnValueOnce({ value: "session-1234" });

      const mockUser = { id: "user-1", name: "John Doe", role: "tenant_admin" };
      const mockSession = {
        id: "session-1234",
        expiresAt: new Date(Date.now() + 1000 * 60 * 60).toISOString(), // 1 hour in future
      };

      mockLimit.mockResolvedValueOnce([
        {
          user: mockUser,
          session: mockSession,
        },
      ]);

      const result = await getSessionUser();

      expect(result).not.toBeNull();
      expect(result?.user).toEqual(mockUser);
      expect(result?.session).toEqual(mockSession);
    });

    it("returns null, deletes cookie, and deletes from DB if session is expired", async () => {
      mockGetCookie.mockReturnValue({ value: "session-expired" });

      const mockUser = { id: "user-1", name: "John Doe", role: "tenant_admin" };
      const mockSession = {
        id: "session-expired",
        expiresAt: new Date(Date.now() - 1000 * 60 * 60).toISOString(), // 1 hour in past
      };

      mockLimit.mockResolvedValueOnce([
        {
          user: mockUser,
          session: mockSession,
        },
      ]);

      const result = await getSessionUser();

      expect(result).toBeNull();
      // Should trigger destroySession
      expect(mockDelete).toHaveBeenCalledTimes(1);
      expect(mockDeleteCookie).toHaveBeenCalledWith("nextlib_session");
    });
  });

  describe("destroySession", () => {
    it("successfully destroys session from DB and deletes cookie", async () => {
      mockGetCookie.mockReturnValueOnce({ value: "session-to-delete" });

      await destroySession();

      expect(mockDelete).toHaveBeenCalledTimes(1);
      expect(mockDeleteCookie).toHaveBeenCalledWith("nextlib_session");
    });
  });
});
