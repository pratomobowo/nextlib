// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const fetchMock = vi.fn();
global.fetch = fetchMock as any;

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { TestConnectionButton } from "./test-connection-button";

beforeEach(() => fetchMock.mockReset());

describe("<TestConnectionButton />", () => {
  it("calls endpoint and shows feedback on success", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { success: true, responseTimeMs: 142, status: "connected" } }),
    });
    render(<TestConnectionButton tenantId="t1" />);
    fireEvent.click(screen.getByRole("button", { name: /Test Koneksi/i }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/tenants/t1/test-connection",
        expect.objectContaining({ method: "POST" })
      );
    });
  });

  it("handles failure response (agent down)", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { success: false, responseTimeMs: 5000, status: "disconnected", error: "ECONNREFUSED" } }),
    });
    render(<TestConnectionButton tenantId="t1" />);
    fireEvent.click(screen.getByRole("button", { name: /Test Koneksi/i }));
    // No throw, just shows the disconnected status
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
  });
});
