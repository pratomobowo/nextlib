import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { knowledgeBase, tenants } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";

/**
 * Knowledge Base CRUD API
 *
 * GET    /api/v1/whatsapp/knowledge-base?tenantId=xxx — List all KB entries
 * POST   /api/v1/whatsapp/knowledge-base              — Create new entry
 * PUT    /api/v1/whatsapp/knowledge-base              — Update entry
 * DELETE /api/v1/whatsapp/knowledge-base?id=xxx       — Delete entry
 */

// Validation schemas
const createSchema = z.object({
  tenantId: z.string().uuid(),
  title: z.string().min(1).max(255),
  content: z.string().min(1),
  category: z.string().max(100).optional(),
  isActive: z.boolean().optional().default(true),
});

const updateSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(255).optional(),
  content: z.string().min(1).optional(),
  category: z.string().max(100).optional().nullable(),
  isActive: z.boolean().optional(),
});

/**
 * GET — List all knowledge base entries for a tenant.
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

    const entries = await db
      .select()
      .from(knowledgeBase)
      .where(eq(knowledgeBase.tenantId, tenantId))
      .orderBy(desc(knowledgeBase.updatedAt));

    return NextResponse.json({
      success: true,
      data: entries,
      count: entries.length,
    });
  } catch (error) {
    console.error("[KnowledgeBase] GET error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST — Create a new knowledge base entry.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = createSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Validation failed",
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const { tenantId, title, content, category, isActive } = parsed.data;

    // Verify tenant exists
    const tenant = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    if (tenant.length === 0) {
      return NextResponse.json(
        { success: false, error: "Tenant not found" },
        { status: 404 }
      );
    }

    const [entry] = await db
      .insert(knowledgeBase)
      .values({
        tenantId,
        title,
        content,
        category: category || null,
        isActive,
      })
      .returning();

    return NextResponse.json({ success: true, data: entry }, { status: 201 });
  } catch (error) {
    console.error("[KnowledgeBase] POST error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PUT — Update an existing knowledge base entry.
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = updateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Validation failed",
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const { id, ...updates } = parsed.data;

    // Build update object with only provided fields
    const updateData: Record<string, any> = { updatedAt: new Date() };
    if (updates.title !== undefined) updateData.title = updates.title;
    if (updates.content !== undefined) updateData.content = updates.content;
    if (updates.category !== undefined) updateData.category = updates.category;
    if (updates.isActive !== undefined) updateData.isActive = updates.isActive;

    const [updated] = await db
      .update(knowledgeBase)
      .set(updateData)
      .where(eq(knowledgeBase.id, id))
      .returning();

    if (!updated) {
      return NextResponse.json(
        { success: false, error: "Entry not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error("[KnowledgeBase] PUT error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE — Delete a knowledge base entry.
 */
export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { success: false, error: "id query parameter is required" },
        { status: 400 }
      );
    }

    const [deleted] = await db
      .delete(knowledgeBase)
      .where(eq(knowledgeBase.id, id))
      .returning();

    if (!deleted) {
      return NextResponse.json(
        { success: false, error: "Entry not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: deleted });
  } catch (error) {
    console.error("[KnowledgeBase] DELETE error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
