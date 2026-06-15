import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { callAgentAnalytics } from "@/lib/agent/agent-client";

/**
 * GET /api/v1/analytics/top-books
 *
 * Returns the most-borrowed titles for the authenticated tenant. Forwards
 * query params (start_date, end_date, limit) to the agent's /top-books
 * endpoint, which queries SLiMS in real time.
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
  const startDate = url.searchParams.get("start_date");
  const endDate = url.searchParams.get("end_date");
  const limit = url.searchParams.get("limit");
  if (startDate) params.start_date = startDate;
  if (endDate) params.end_date = endDate;
  if (limit) params.limit = parseInt(limit, 10);

  const { status, body } = await callAgentAnalytics(tenantId, "top-books", params);
  return NextResponse.json(body, { status });
}
