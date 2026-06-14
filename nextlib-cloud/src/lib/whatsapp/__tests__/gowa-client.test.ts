import { describe, it, expect, vi, beforeEach } from "vitest";
import { GowaClient, GowaApiError } from "../gowa-client";

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("GowaClient (Device Scoped)", () => {
  let client: GowaClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new GowaClient("http://mock-gowa:3010");
  });

  describe("request scoping via X-Device-Id header", () => {
    it("includes X-Device-Id header in login request", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 200,
          message: "Success",
          results: { qr_link: "base64_qr", qr_duration: 30 },
        }),
      });

      const response = await client.login("tenant-test-id");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [calledUrl, calledInit] = mockFetch.mock.calls[0];
      
      expect(calledUrl).toBe("http://mock-gowa:3010/app/login");
      expect(calledInit.method).toBe("POST");
      
      // Verify X-Device-Id header is passed
      const headers = calledInit.headers as Headers;
      expect(headers.get("X-Device-Id")).toBe("tenant-test-id");
      expect(headers.get("Content-Type")).toBe("application/json");

      expect(response.results.qr_link).toBe("base64_qr");
    });

    it("includes X-Device-Id header in sendText request", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 200,
          message: "Message sent",
          results: { message_id: "msg123" },
        }),
      });

      await client.sendText("628123456789", "Hello World", "tenant-test-id");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [calledUrl, calledInit] = mockFetch.mock.calls[0];

      expect(calledUrl).toBe("http://mock-gowa:3010/send/message");
      expect(calledInit.method).toBe("POST");
      
      const headers = calledInit.headers as Headers;
      expect(headers.get("X-Device-Id")).toBe("tenant-test-id");

      const body = JSON.parse(calledInit.body);
      expect(body.phone).toBe("628123456789");
      expect(body.message).toBe("Hello World");
    });

    it("includes X-Device-Id header in logout request", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: 200, message: "Logged out" }),
      });

      await client.logout("tenant-test-id");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [calledUrl, calledInit] = mockFetch.mock.calls[0];

      expect(calledUrl).toBe("http://mock-gowa:3010/app/logout");
      const headers = calledInit.headers as Headers;
      expect(headers.get("X-Device-Id")).toBe("tenant-test-id");
    });
  });

  describe("error handling", () => {
    it("throws GowaApiError on HTTP error status", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ code: 400, message: "Bad Request details" }),
      });

      await expect(client.login("tenant-test-id")).rejects.toThrow(GowaApiError);
    });
  });
});
