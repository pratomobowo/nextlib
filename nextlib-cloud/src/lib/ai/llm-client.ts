import OpenAI from "openai";

/**
 * Multi-provider LLM client using OpenAI-compatible SDK.
 *
 * Default: DeepSeek (deepseek-chat)
 * Supports any OpenAI-compatible API via AI_BASE_URL env var:
 * - DeepSeek: https://api.deepseek.com
 * - OpenRouter: https://openrouter.ai/api/v1
 * - Together AI: https://api.together.xyz/v1
 * - Groq: https://api.groq.com/openai/v1
 * - OpenAI: https://api.openai.com/v1
 *
 * Zero code change to switch provider — just update env vars.
 */

const AI_BASE_URL = process.env.AI_BASE_URL || "https://api.deepseek.com";
const AI_API_KEY = process.env.AI_API_KEY || "";
const AI_MODEL = process.env.AI_MODEL || "deepseek-chat";

// Timeout for LLM requests (NFR-2: max 5 seconds)
const LLM_TIMEOUT_MS = 5000;

let _client: OpenAI | null = null;

/**
 * Create or return singleton OpenAI-compatible client.
 */
export function createLLMClient(): OpenAI {
  if (!_client) {
    if (!AI_API_KEY) {
      console.warn(
        "[LLM] AI_API_KEY not set. LLM features will use fallback responses."
      );
    }

    _client = new OpenAI({
      baseURL: AI_BASE_URL,
      apiKey: AI_API_KEY,
      timeout: LLM_TIMEOUT_MS,
    });
  }
  return _client;
}

/**
 * Intent classification result from LLM.
 */
export interface IntentResult {
  intent: "faq" | "circulation" | "greeting" | "unknown";
  confidence: number;
  entities: Record<string, string>;
}

/**
 * Conversation message for context.
 */
export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * System prompt for intent classification.
 * Instructs the LLM to classify the user's message and extract entities.
 */
const INTENT_SYSTEM_PROMPT = `Kamu adalah AI asisten pustakawan virtual untuk perpustakaan kampus di Indonesia.
Tugasmu adalah mengklasifikasikan pesan dari pengguna WhatsApp ke dalam salah satu intent berikut:

1. "greeting" — Salam, sapaan, atau perkenalan (halo, hi, selamat pagi, dll)
2. "faq" — Pertanyaan tentang informasi umum perpustakaan (jam buka, aturan, layanan, cara daftar, dll)
3. "circulation" — Pertanyaan terkait sirkulasi buku (cek denda, status peminjaman, perpanjang, dll). Biasanya menyebutkan NIM, nama anggota, atau judul buku.
4. "unknown" — Pesan yang tidak berhubungan dengan perpustakaan

Respons HARUS dalam format JSON VALID berikut (tanpa markdown code block):
{
  "intent": "greeting|faq|circulation|unknown",
  "confidence": 0.0-1.0,
  "entities": {
    "nim": "nomor induk mahasiswa jika disebutkan",
    "book_title": "judul buku jika disebutkan",
    "member_name": "nama anggota jika disebutkan",
    "query_type": "jenis query sirkulasi: check_fine|check_loan|extend|return_status"
  }
}

Hanya sertakan key entities yang relevan. Jangan tambahkan key yang tidak disebutkan di pesan.`;

/**
 * System prompt for natural response generation.
 * Makes the AI respond like a friendly librarian in Bahasa Indonesia.
 */
const RESPONSE_SYSTEM_PROMPT = `Kamu adalah AI asisten pustakawan virtual yang ramah dan profesional untuk perpustakaan kampus di Indonesia.

Aturan:
- Selalu gunakan Bahasa Indonesia yang sopan dan ramah
- Gunakan emoji secukupnya (1-2 per pesan) untuk kesan friendly
- Jawab dengan ringkas tapi informatif
- Jika data berasal dari sistem (JSON), format menjadi pesan yang mudah dibaca
- Jangan sebutkan istilah teknis seperti JSON, API, database
- Gunakan format WhatsApp (*bold*, _italic_, ~strikethrough~)
- Maksimal 500 karakter per respons`;

/**
 * Classify the intent of an incoming WhatsApp message.
 *
 * @param message - The user's message text
 * @param context - Previous conversation messages for context
 * @returns Classified intent with extracted entities
 */
export async function classifyIntent(
  message: string,
  context: ConversationMessage[] = []
): Promise<IntentResult> {
  try {
    if (!AI_API_KEY) {
      return fallbackClassification(message);
    }

    const client = createLLMClient();

    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: INTENT_SYSTEM_PROMPT },
      // Include last 3 messages for context
      ...context.slice(-3).map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      { role: "user", content: message },
    ];

    const response = await client.chat.completions.create({
      model: AI_MODEL,
      messages,
      temperature: 0.1, // Low temperature for consistent classification
      max_tokens: 200,
    });

    const content = response.choices[0]?.message?.content?.trim() || "";

    // Parse JSON response, stripping markdown code blocks if present
    const jsonStr = content
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
    const result = JSON.parse(jsonStr) as IntentResult;

    // Validate intent value
    const validIntents = ["faq", "circulation", "greeting", "unknown"] as const;
    if (!validIntents.includes(result.intent as any)) {
      result.intent = "unknown";
    }

    return result;
  } catch (error) {
    console.error("[LLM] Intent classification failed:", error);
    return fallbackClassification(message);
  }
}

/**
 * Generate a natural language response from raw data.
 *
 * @param data - Raw data (FAQ text, SLiMS JSON, etc.)
 * @param intent - The classified intent type
 * @param userMessage - The original user message
 * @returns Natural language response in Bahasa Indonesia
 */
export async function generateResponse(
  data: any,
  intent: string,
  userMessage: string
): Promise<string> {
  try {
    if (!AI_API_KEY) {
      return fallbackResponse(intent, data);
    }

    const client = createLLMClient();

    const dataContext =
      typeof data === "string" ? data : JSON.stringify(data, null, 2);

    const response = await client.chat.completions.create({
      model: AI_MODEL,
      messages: [
        { role: "system", content: RESPONSE_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Pengguna bertanya: "${userMessage}"

Intent: ${intent}
Data yang tersedia:
${dataContext}

Buatkan respons yang natural dan ramah berdasarkan data di atas.`,
        },
      ],
      temperature: 0.7,
      max_tokens: 500,
    });

    return (
      response.choices[0]?.message?.content?.trim() ||
      fallbackResponse(intent, data)
    );
  } catch (error) {
    console.error("[LLM] Response generation failed:", error);
    return fallbackResponse(intent, data);
  }
}

/**
 * Fallback intent classification using keyword matching.
 * Used when LLM is unavailable or API key is not set.
 */
function fallbackClassification(message: string): IntentResult {
  const lower = message.toLowerCase();

  // Greeting patterns
  if (/^(halo|hai|hi|hello|hey|selamat|assalamualaikum|pagi|siang|sore|malam)\b/i.test(lower)) {
    return { intent: "greeting", confidence: 0.8, entities: {} };
  }

  // Circulation patterns
  const nimMatch = lower.match(/\b(\d{7,10})\b/);
  if (
    /\b(denda|pinjam|kembali|perpanjang|fine|loan|borrow|extend|nim)\b/i.test(lower)
  ) {
    const entities: Record<string, string> = {};
    if (nimMatch) entities.nim = nimMatch[1];
    return { intent: "circulation", confidence: 0.7, entities };
  }

  // FAQ patterns
  if (
    /\b(jam|buka|tutup|aturan|rules|cara|how|daftar|register|layanan|service|lokasi|alamat|syarat|prosedur)\b/i.test(
      lower
    )
  ) {
    return { intent: "faq", confidence: 0.6, entities: {} };
  }

  return { intent: "unknown", confidence: 0.5, entities: {} };
}

/**
 * Fallback response when LLM is unavailable.
 */
function fallbackResponse(intent: string, data: any): string {
  switch (intent) {
    case "greeting":
      return "Halo! 👋 Saya asisten pustakawan virtual. Ada yang bisa saya bantu terkait layanan perpustakaan?";

    case "faq":
      if (typeof data === "string" && data.length > 0) {
        return data;
      }
      return "Mohon maaf, saya belum memiliki informasi untuk pertanyaan tersebut. Silakan hubungi petugas perpustakaan secara langsung. 🙏";

    case "circulation":
      if (data && typeof data === "object") {
        return `Berikut informasi yang saya temukan:\n${JSON.stringify(data, null, 2)}`;
      }
      return "Mohon maaf, saya tidak dapat menemukan data sirkulasi yang dimaksud. Pastikan NIM atau informasi yang diberikan sudah benar. 📚";

    default:
      return "Mohon maaf, saya belum bisa memahami pertanyaan Anda. Saya bisa membantu terkait:\n\n📚 Informasi perpustakaan\n📋 Cek denda & peminjaman\n❓ FAQ layanan\n\nSilakan coba bertanya dengan kata kunci yang lebih spesifik. 🙏";
  }
}
