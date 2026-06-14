/**
 * Gowa (go-whatsapp-web-multidevice) REST API Client
 *
 * Wraps the Gowa WhatsApp engine API for session management and messaging.
 * Uses native fetch() with AbortController for timeouts.
 *
 * @see https://github.com/aldinokemal/go-whatsapp-web-multidevice
 */

const GOWA_URL = process.env.WHATSAPP_API_URL || "http://localhost:3010";
const DEFAULT_TIMEOUT_MS = 10_000;

export interface GowaLoginResponse {
  code: number;
  message: string;
  results: {
    qr_link: string;
    qr_duration: number;
  };
}

export interface GowaGenericResponse {
  code: number;
  message: string;
  results?: unknown;
}

export interface GowaSendResponse {
  code: number;
  message: string;
  results?: {
    message_id?: string;
    status?: string;
  };
}

export class GowaClient {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || GOWA_URL;
  }

  /**
   * Make a fetch request with timeout and standardized error handling.
   */
  private async request<T = GowaGenericResponse>(
    path: string,
    options: RequestInit = {},
    deviceId?: string,
    timeoutMs: number = DEFAULT_TIMEOUT_MS
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      console.log(`[GowaClient] ${options.method || "GET"} ${url}${deviceId ? ` (Device: ${deviceId})` : ""}`);

      const headers = new Headers(options.headers);
      headers.set("Content-Type", "application/json");

      if (deviceId) {
        headers.set("X-Device-Id", deviceId);
      }

      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers,
      });

      const data = await response.json();

      if (!response.ok) {
        console.error(
          `[GowaClient] HTTP ${response.status} from ${path}:`,
          data
        );
        throw new GowaApiError(
          data.message || `HTTP ${response.status}`,
          response.status,
          data
        );
      }

      console.log(`[GowaClient] Response from ${path}:`, {
        code: data.code,
        message: data.message,
      });

      return data as T;
    } catch (error) {
      if (error instanceof GowaApiError) {
        throw error;
      }

      if (error instanceof Error && error.name === "AbortError") {
        console.error(`[GowaClient] Request to ${path} timed out after ${timeoutMs}ms`);
        throw new GowaApiError(
          `Request timed out after ${timeoutMs}ms`,
          408,
          null
        );
      }

      console.error(`[GowaClient] Network error for ${path}:`, error);
      throw new GowaApiError(
        error instanceof Error
          ? `Network error: ${error.message}`
          : "Unknown network error",
        0,
        null
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Login and get QR code for scanning.
   * POST /app/login — triggers QR code generation for WhatsApp Web pairing.
   */
  async login(deviceId: string): Promise<GowaLoginResponse> {
    return this.request<GowaLoginResponse>("/app/login", {
      method: "POST",
      body: JSON.stringify({}),
    }, deviceId);
  }

  /**
   * Check connected devices.
   * GET /app/devices — returns list of connected devices and their status.
   */
  async getDevices(): Promise<GowaGenericResponse> {
    return this.request<GowaGenericResponse>("/app/devices", {
      method: "GET",
    });
  }

  /**
   * Get user info / connection status.
   * GET /user/info — returns current user info if connected.
   */
  async getUserInfo(deviceId: string): Promise<GowaGenericResponse> {
    return this.request<GowaGenericResponse>("/user/info", {
      method: "GET",
    }, deviceId);
  }

  /**
   * Send a text message to a phone number.
   * POST /send/message — sends a text message via WhatsApp.
   *
   * @param phone - Phone number in international format (e.g., "628123456789")
   * @param message - The message text to send
   * @param deviceId - The tenant's device ID to scope the request
   */
  async sendText(
    phone: string,
    message: string,
    deviceId: string,
  ): Promise<GowaSendResponse> {
    return this.request<GowaSendResponse>("/send/message", {
      method: "POST",
      body: JSON.stringify({
        phone,
        message,
      }),
    }, deviceId);
  }

  /**
   * Logout and disconnect WhatsApp session.
   * POST /app/logout — disconnects the current WhatsApp Web session.
   */
  async logout(deviceId: string): Promise<GowaGenericResponse> {
    return this.request<GowaGenericResponse>("/app/logout", {
      method: "POST",
      body: JSON.stringify({}),
    }, deviceId);
  }

  /**
   * Reconnect an existing WhatsApp session.
   * POST /app/reconnect — attempts to reconnect a previously paired device.
   */
  async reconnect(deviceId: string): Promise<GowaGenericResponse> {
    return this.request<GowaGenericResponse>("/app/reconnect", {
      method: "POST",
      body: JSON.stringify({}),
    }, deviceId);
  }
}

/**
 * Custom error class for Gowa API errors.
 */
export class GowaApiError extends Error {
  public statusCode: number;
  public responseData: unknown;

  constructor(message: string, statusCode: number, responseData: unknown) {
    super(message);
    this.name = "GowaApiError";
    this.statusCode = statusCode;
    this.responseData = responseData;
  }
}

/**
 * Singleton client instance for use across the application.
 */
export const gowaClient = new GowaClient();
