// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const fetchMock = vi.fn();
global.fetch = fetchMock as unknown as typeof global.fetch;
Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { RegenerateSecretModal } from "./regenerate-secret-modal";

beforeEach(() => fetchMock.mockReset());

describe("<RegenerateSecretModal />", () => {
  it("regenerate button disabled until confirm checked", () => {
    render(<RegenerateSecretModal open onOpenChange={() => {}} tenantId="t1" />);
    const btn = screen.getByRole("button", { name: /Regenerate Token/i });
    expect(btn).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/saya paham/i));
    expect(btn).not.toBeDisabled();
  });

  it("shows one-time token after success", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { api_token: "newsecrethex", message: "ok" } }),
    });
    render(<RegenerateSecretModal open onOpenChange={() => {}} tenantId="t1" />);
    fireEvent.click(screen.getByLabelText(/saya paham/i));
    fireEvent.click(screen.getByRole("button", { name: /Regenerate Token/i }));
    await waitFor(() => {
      expect(screen.getByText("newsecrethex")).toBeTruthy();
    });
  });

  it("copies token to clipboard", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { api_token: "newsecrethex" } }),
    });
    render(<RegenerateSecretModal open onOpenChange={() => {}} tenantId="t1" />);
    fireEvent.click(screen.getByLabelText(/saya paham/i));
    fireEvent.click(screen.getByRole("button", { name: /Regenerate Token/i }));
    await waitFor(() => screen.getByText("newsecrethex"));
    fireEvent.click(screen.getByRole("button", { name: /Salin/i }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("newsecrethex");
  });
});
