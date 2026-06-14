import { NextResponse } from 'next/server'
import { randomBytes, createHash } from 'crypto'
import { db } from '@/lib/db'
import { tenants } from '@/lib/db/schema'
import { encrypt } from '@/lib/crypto'
import { z } from 'zod/v4'
import { eq } from 'drizzle-orm'
import { getSessionUser } from '@/lib/auth/session'

/**
 * GET /api/v1/tenants
 *
 * Lists tenants for the authenticated user.
 * - super_admin: sees all tenants.
 * - tenant_admin / librarian: sees only their own tenant.
 *
 * Returns only non-sensitive columns. `apiSecretEncrypted`, `tokenHash`, and
 * the encrypted `slimsBaseUrl` are never exposed. Response is wrapped as
 * `{ data: [...] }` to match the consumer (`whatsapp/knowledge-base/page.tsx`).
 */
export async function GET() {
  try {
    const sessionUser = await getSessionUser()

    if (!sessionUser) {
      return NextResponse.json(
        {
          error: true,
          code: 'UNAUTHORIZED',
          message: 'Authentication required. Please log in.',
        },
        { status: 401 }
      )
    }

    const { user } = sessionUser

    // Build the query: super_admin sees everyone; tenant-scoped users only see
    // their own tenant (enforced server-side — no client trust).
    const query = db
      .select({
        id: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
        status: tenants.status,
        createdAt: tenants.createdAt,
        updatedAt: tenants.updatedAt,
      })
      .from(tenants)

    const rows =
      user.role === 'super_admin'
        ? await query
        : await query.where(eq(tenants.id, user.tenantId as string))

    return NextResponse.json({ data: rows })
  } catch (error: unknown) {
    console.error('Error listing tenants:', error)
    return NextResponse.json(
      {
        error: true,
        code: 'SERVER_ERROR',
        message: 'An unexpected error occurred',
      },
      { status: 500 }
    )
  }
}

/**
 * Input validation schema for tenant creation.
 */
const createTenantSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase kebab-case')
    .max(100)
    .optional(),
  slims_base_url: z.url('Must be a valid URL'),
})

/**
 * Convert a name string to a URL-safe kebab-case slug.
 */
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove non-word chars (except spaces and hyphens)
    .replace(/[\s_]+/g, '-') // Replace spaces/underscores with hyphens
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .replace(/^-+|-+$/g, '') // Trim leading/trailing hyphens
}

/**
 * Ensure the slug is unique in the database by appending a numeric suffix if needed.
 */
async function ensureUniqueSlug(baseSlug: string): Promise<string> {
  let slug = baseSlug
  let suffix = 1

  while (true) {
    const existing = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, slug))
      .limit(1)

    if (existing.length === 0) {
      return slug
    }

    slug = `${baseSlug}-${suffix}`
    suffix++

    // Safety: prevent infinite loops
    if (suffix > 100) {
      throw new Error('Unable to generate unique slug')
    }
  }
}

/**
 * POST /api/v1/tenants
 *
 * Creates a new tenant with:
 * - Unique slug (auto-generated from name if not provided)
 * - Generated API secret (for agent authentication)
 * - SHA-256 hash of the secret (for quick lookup)
 * - AES-256-GCM encrypted secret and SLiMS base URL
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()

    // Validate input
    const parsed = createTenantSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: true,
          code: 'VALIDATION_ERROR',
          message: 'Invalid input',
          details: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
        { status: 400 }
      )
    }

    const { name, slug: providedSlug, slims_base_url } = parsed.data

    // Generate or validate slug
    const baseSlug = providedSlug || toSlug(name)
    if (!baseSlug) {
      return NextResponse.json(
        {
          error: true,
          code: 'VALIDATION_ERROR',
          message: 'Unable to generate slug from provided name',
        },
        { status: 400 }
      )
    }

    const slug = await ensureUniqueSlug(baseSlug)

    // Generate unique API secret (32 bytes = 64 hex chars)
    const apiSecret = randomBytes(32).toString('hex')

    // Hash the secret for quick lookup (SHA-256 → 64 hex chars)
    const tokenHash = createHash('sha256').update(apiSecret).digest('hex')

    // Encrypt the secret and base URL using AES-256-GCM
    const encryptionKey = process.env.AES_256_ENCRYPTION_KEY
    if (!encryptionKey) {
      return NextResponse.json(
        {
          error: true,
          code: 'SERVER_ERROR',
          message: 'Encryption key not configured',
        },
        { status: 500 }
      )
    }

    const apiSecretEncrypted = encrypt(apiSecret, encryptionKey)
    const slimsBaseUrlEncrypted = encrypt(slims_base_url, encryptionKey)

    // Insert tenant record
    const [tenant] = await db
      .insert(tenants)
      .values({
        name,
        slug,
        slimsBaseUrl: slimsBaseUrlEncrypted,
        apiSecretEncrypted,
        tokenHash,
        status: 'pending',
      })
      .returning({
        id: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
        status: tenants.status,
        createdAt: tenants.createdAt,
      })

    // Return created tenant with the raw API token (shown only once)
    return NextResponse.json(
      {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        status: tenant.status,
        api_token: apiSecret,
        created_at: tenant.createdAt,
      },
      { status: 201 }
    )
  } catch (error: unknown) {
    // Handle unique constraint violation (duplicate slug)
    if (
      error instanceof Error &&
      'code' in error &&
      (error as { code: string }).code === '23505'
    ) {
      return NextResponse.json(
        {
          error: true,
          code: 'DUPLICATE_SLUG',
          message: 'A tenant with this slug already exists',
        },
        { status: 409 }
      )
    }

    console.error('Error creating tenant:', error)
    return NextResponse.json(
      {
        error: true,
        code: 'SERVER_ERROR',
        message: 'An unexpected error occurred',
      },
      { status: 500 }
    )
  }
}
