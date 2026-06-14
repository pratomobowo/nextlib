import { db } from "@/lib/db";
import { knowledgeBase, tenants, whatsappSessions } from "@/lib/db/schema";
import { eq, and, ilike } from "drizzle-orm";
import { classifyIntent, generateResponse, type IntentResult } from "./llm-client";
import { decrypt } from "@/lib/crypto";

/**
 * Intent handlers for WhatsApp message processing.
 * Each handler processes a specific intent type and returns a response.
 */

/**
 * Process an incoming message through intent classification and appropriate handler.
 *
 * @param tenantId - The tenant ID that received the message
 * @param message - The user's message text
 * @param context - Previous conversation context
 * @returns Object with response text and classified intent
 */
export async function processMessage(
  tenantId: string,
  message: string,
  context: Array<{ role: "user" | "assistant"; content: string }> = []
): Promise<{ response: string; intent: IntentResult }> {
  // Step 1: Classify intent
  const intent = await classifyIntent(message, context);

  console.log(
    `[IntentHandler] Classified as "${intent.intent}" (confidence: ${intent.confidence})`
  );

  // Step 2: Execute appropriate handler
  let responseData: any;
  let response: string;

  switch (intent.intent) {
    case "greeting":
      response = await handleGreeting();
      break;

    case "faq":
      responseData = await handleFAQ(tenantId, message);
      response = await generateResponse(responseData, "faq", message);
      break;

    case "circulation":
      responseData = await handleCirculation(tenantId, intent.entities);
      response = await generateResponse(responseData, "circulation", message);
      break;

    case "unknown":
    default:
      response = handleUnknown();
      break;
  }

  return { response, intent };
}

/**
 * Handle greeting messages with a friendly welcome.
 */
async function handleGreeting(): Promise<string> {
  const greetings = [
    "Halo! 👋 Selamat datang di layanan Pustakawan Virtual. Saya bisa membantu Anda untuk:\n\n📚 Informasi perpustakaan (jam buka, aturan, dll)\n📋 Cek denda & status peminjaman\n❓ Pertanyaan umum lainnya\n\nSilakan tanyakan apa saja! 😊",
    "Hai! 👋 Saya asisten pustakawan virtual. Ada yang bisa saya bantu?\n\n📚 Cek info perpustakaan\n📋 Cek denda/peminjaman (sebutkan NIM)\n❓ FAQ & layanan\n\nKetik pertanyaan Anda ya! 😊",
    "Assalamu'alaikum! 🙏 Saya pustakawan virtual yang siap membantu Anda.\n\n📚 Info perpustakaan\n📋 Sirkulasi & denda\n❓ Pertanyaan umum\n\nAda yang bisa dibantu? 😊",
  ];

  return greetings[Math.floor(Math.random() * greetings.length)];
}

/**
 * Handle FAQ intent by searching the knowledge base.
 *
 * @param tenantId - Tenant ID to scope the search
 * @param message - User's question for keyword matching
 * @returns Matching KB entries or empty message
 */
async function handleFAQ(
  tenantId: string,
  message: string
): Promise<string | { entries: any[]; query: string }> {
  try {
    // Search knowledge base for relevant entries
    const keywords = extractKeywords(message);
    let entries: any[] = [];

    // Try matching by keywords against title and content
    for (const keyword of keywords) {
      const results = await db
        .select({
          title: knowledgeBase.title,
          content: knowledgeBase.content,
          category: knowledgeBase.category,
        })
        .from(knowledgeBase)
        .where(
          and(
            eq(knowledgeBase.tenantId, tenantId),
            eq(knowledgeBase.isActive, true),
            ilike(knowledgeBase.content, `%${keyword}%`)
          )
        )
        .limit(3);

      entries.push(...results);
    }

    // Also try title matching
    if (entries.length === 0) {
      for (const keyword of keywords) {
        const results = await db
          .select({
            title: knowledgeBase.title,
            content: knowledgeBase.content,
            category: knowledgeBase.category,
          })
          .from(knowledgeBase)
          .where(
            and(
              eq(knowledgeBase.tenantId, tenantId),
              eq(knowledgeBase.isActive, true),
              ilike(knowledgeBase.title, `%${keyword}%`)
            )
          )
          .limit(3);

        entries.push(...results);
      }
    }

    // Deduplicate entries
    const uniqueEntries = entries.filter(
      (entry, index, self) =>
        index === self.findIndex((e) => e.title === entry.title)
    );

    if (uniqueEntries.length === 0) {
      return "Tidak ditemukan informasi terkait pertanyaan tersebut di basis pengetahuan perpustakaan.";
    }

    return { entries: uniqueEntries, query: message };
  } catch (error) {
    console.error("[IntentHandler] FAQ lookup failed:", error);
    return "Terjadi kesalahan saat mencari informasi. Silakan coba lagi nanti.";
  }
}

/**
 * Handle circulation intent by querying the tenant's SLiMS NextLib-Agent.
 *
 * @param tenantId - Tenant ID to get SLiMS connection info
 * @param entities - Extracted entities (NIM, book title, etc.)
 * @returns SLiMS API response data
 */
async function handleCirculation(
  tenantId: string,
  entities: Record<string, string>
): Promise<any> {
  try {
    // Get tenant's SLiMS connection info
    const tenant = await db
      .select({
        slimsBaseUrl: tenants.slimsBaseUrl,
        apiSecretEncrypted: tenants.apiSecretEncrypted,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    if (tenant.length === 0) {
      return { error: "Tenant tidak ditemukan." };
    }

    const { slimsBaseUrl, apiSecretEncrypted } = tenant[0];

    // Decrypt API secret
    let apiSecret: string;
    try {
      const encryptionKey = process.env.AES_256_ENCRYPTION_KEY || "";
      apiSecret = decrypt(apiSecretEncrypted, encryptionKey);
    } catch {
      return { error: "Konfigurasi koneksi SLiMS bermasalah. Hubungi administrator." };
    }

    // Determine query type and build API URL
    const queryType = entities.query_type || "check_fine";
    const nim = entities.nim || "";
    const memberName = entities.member_name || "";

    if (!nim && !memberName) {
      return {
        error:
          "Mohon sebutkan NIM atau nama anggota untuk pengecekan sirkulasi. Contoh: 'Cek denda NIM 2201002'",
      };
    }

    // Call SLiMS NextLib-Agent API
    const agentUrl = `${slimsBaseUrl}/api/nextlib`;
    const searchParam = nim ? `nim=${nim}` : `name=${encodeURIComponent(memberName)}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); // 5s timeout per NFR-2

    try {
      const response = await fetch(
        `${agentUrl}/circulation?${searchParam}&type=${queryType}`,
        {
          headers: {
            Authorization: `Bearer ${apiSecret}`,
            "Content-Type": "application/json",
          },
          signal: controller.signal,
        }
      );

      clearTimeout(timeout);

      if (!response.ok) {
        return {
          error: `Tidak dapat menghubungi sistem perpustakaan (HTTP ${response.status}). Silakan coba lagi nanti.`,
        };
      }

      return await response.json();
    } catch (fetchError: any) {
      clearTimeout(timeout);
      if (fetchError.name === "AbortError") {
        return {
          error:
            "Koneksi ke sistem perpustakaan timeout. Silakan coba lagi nanti. ⏱️",
        };
      }
      throw fetchError;
    }
  } catch (error) {
    console.error("[IntentHandler] Circulation query failed:", error);
    return {
      error:
        "Terjadi kesalahan saat mengambil data sirkulasi. Silakan coba lagi nanti. 🙏",
    };
  }
}

/**
 * Handle unknown/unrecognized messages.
 */
function handleUnknown(): string {
  return "Mohon maaf, saya belum bisa memahami pertanyaan Anda. 🙏\n\nSaya bisa membantu terkait:\n📚 *Informasi perpustakaan* (jam buka, aturan, layanan)\n📋 *Cek denda & peminjaman* (sebutkan NIM)\n❓ *Pertanyaan umum* lainnya\n\nSilakan coba bertanya dengan kata kunci yang lebih spesifik ya!";
}

/**
 * Extract meaningful keywords from a message for FAQ search.
 */
function extractKeywords(message: string): string[] {
  const stopWords = new Set([
    "yang",
    "di",
    "ke",
    "dari",
    "dan",
    "atau",
    "ini",
    "itu",
    "ada",
    "apa",
    "siapa",
    "mana",
    "kapan",
    "dimana",
    "gimana",
    "bagaimana",
    "berapa",
    "bisa",
    "boleh",
    "mau",
    "ingin",
    "saya",
    "aku",
    "kamu",
    "kita",
    "mereka",
    "nya",
    "lah",
    "kah",
    "tah",
    "dong",
    "sih",
    "deh",
    "kok",
    "kan",
    "ya",
    "tidak",
    "bukan",
    "belum",
    "sudah",
    "dengan",
    "untuk",
    "pada",
    "akan",
    "telah",
    "sedang",
    "masih",
    "juga",
    "hanya",
    "baru",
    "lagi",
    "pernah",
    "tolong",
    "mohon",
    "cek",
    "check",
    "lihat",
    "info",
    "informasi",
  ]);

  return message
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !stopWords.has(word));
}
