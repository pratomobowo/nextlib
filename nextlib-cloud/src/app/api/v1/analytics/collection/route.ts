import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { callAgentAnalytics } from "@/lib/agent/agent-client";

/**
 * GET /api/v1/analytics/collection
 *
 * Returns DDC distribution + collection-type distribution + headline totals.
 * No query params — covers the whole collection.
 */
export async function GET() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json(
      { error: true, code: "UNAUTHORIZED", message: "Authentication required." },
      { status: 401 }
    );
  }
  const tenantId = sessionUser.user.tenantId;
  if (!tenantId) {
    return NextResponse.json(
      { error: true, code: "FORBIDDEN", message: "No tenant bound to this account." },
      { status: 403 }
    );
  }

  const { status, body } = await callAgentAnalytics(tenantId, "collection-stats", {});
  return NextResponse.json(body, { status });
}
