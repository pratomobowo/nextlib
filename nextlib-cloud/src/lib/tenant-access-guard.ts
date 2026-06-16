import type { User } from "@/lib/db/schema";

export type AccessResult =
  | { allowed: true }
  | { allowed: false; status: 401 | 403 | 404; code: string; message: string };

/**
 * Checks whether the current user can access (read/write) the given tenant.
 *
 * Rules:
 *  - Unauthenticated → 401
 *  - super_admin → allowed on any tenant
 *  - tenant_admin / librarian → allowed only if user.tenantId === tenantId
 *  - Unknown role → 403
 */
export function checkTenantAccess(
  user: User | null,
  tenantId: string
): AccessResult {
  if (!user) {
    return {
      allowed: false,
      status: 401,
      code: "UNAUTHORIZED",
      message: "Authentication required. Please log in.",
    };
  }

  if (user.role === "super_admin") return { allowed: true };

  if (user.role === "tenant_admin" || user.role === "librarian") {
    if (user.tenantId === tenantId) return { allowed: true };
    return {
      allowed: false,
      status: 403,
      code: "FORBIDDEN",
      message: "You do not have access to this tenant.",
    };
  }

  return {
    allowed: false,
    status: 403,
    code: "FORBIDDEN",
    message: "Unknown user role.",
  };
}
