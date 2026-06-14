import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { waMessageLog } from "@/lib/db/schema";
import { eq, and, gte, sql } from "drizzle-orm";

/**
 * GET /api/v1/whatsapp/stats?tenantId=xxx
 *
 * Returns today's message statistics for a tenant:
 * - incoming/outgoing message counts
 * - average response time
 * - intent type breakdown
 */
export async function GET(request: NextRequest) {
  try {
    const tenantId = request.nextUrl.searchParams.get("tenantId");

    if (!tenantId) {
      return NextResponse.json(
        { success: false, error: "tenantId query parameter is required" },
        { status: 400 }
      );
    }

    // Get start of today (UTC)
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    // Query message counts for today
    const logs = await db
      .select({
        direction: waMessageLog.direction,
        intentType: waMessageLog.intentType,
        responseTimeMs: waMessageLog.responseTimeMs,
      })
      .from(waMessageLog)
      .where(
        and(
          eq(waMessageLog.tenantId, tenantId),
          gte(waMessageLog.processedAt, todayStart)
        )
      );

    // Calculate stats
    let incoming = 0;
    let outgoing = 0;
    let totalResponseMs = 0;
    let responseCount = 0;
    const intentBreakdown = { faq: 0, circulation: 0, greeting: 0, unknown: 0 };

    for (const log of logs) {
      if (log.direction === "incoming") {
        incoming++;
        // Count intents only for incoming messages
        const intent = log.intentType as keyof typeof intentBreakdown;
        if (intent in intentBreakdown) {
          intentBreakdown[intent]++;
        }
      } else {
        outgoing++;
      }

      if (log.responseTimeMs) {
        totalResponseMs += log.responseTimeMs;
        responseCount++;
      }
    }

    const avgResponseMs =
      responseCount > 0 ? Math.round(totalResponseMs / responseCount) : 0;

    return NextResponse.json({
      success: true,
      data: {
        incoming,
        outgoing,
        avgResponseMs,
        intentBreakdown,
      },
    });
  } catch (error) {
    console.error("[Stats] Error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
