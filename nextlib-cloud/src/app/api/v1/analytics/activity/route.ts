import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { callAgentAnalytics } from "@/lib/agent/agent-client";

/**
 * GET /api/v1/analytics/activity
 *
 * Returns loan trends, member demographics, activity classification, and peak
 * visit hours. Query param: months (default 12).
 */
export async function GET(request: Request) {
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

  const url = new URL(request.url);
  const params: Record<string, unknown> = {};
  const months = url.searchParams.get("months");
  if (months) params.months = parseInt(months, 10);

  const { status, body } = await callAgentAnalytics(tenantId, "member-activity", params);
  return NextResponse.json(body, { status });
}
