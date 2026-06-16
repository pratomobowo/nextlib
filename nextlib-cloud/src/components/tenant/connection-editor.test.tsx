// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh, push: vi.fn() }),
}));

const fetchMock = vi.fn();
global.fetch = fetchMock as any;

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { ConnectionEditor } from "./connection-editor";

beforeEach(() => {
  fetchMock.mockReset();
  mockRefresh.mockReset();
  vi.spyOn(window, "alert").mockImplementation(() => {});
});

const tenant = {
  id: "t1",
  name: "Universitas NextLib",
  slug: "universitas-nextlib",
  status: "connected",
};

describe("<ConnectionEditor />", () => {
  it("renders with initial values", () => {
    render(<ConnectionEditor tenant={tenant} />);
    expect(screen.getByDisplayValue("Universitas NextLib")).toBeTruthy();
  });

  it("shows validation error for invalid URL", async () => {
    render(<ConnectionEditor tenant={tenant} />);
    const urlInput = screen.getByLabelText(/URL SLiMS/i);
    fireEvent.change(urlInput, { target: { value: "not-a-url" } });
    fireEvent.click(screen.getByRole("button", { name: /Simpan/i }));
    await waitFor(() => {
      expect(screen.getByText(/URL yang valid/i)).toBeTruthy();
    });
  });

  it("PATCHes on save and toasts on success", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { ...tenant, slimsBaseUrl: "https://slims.x" },
      }),
    });
    render(<ConnectionEditor tenant={tenant} />);
    fireEvent.click(screen.getByRole("button", { name: /Simpan/i }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/tenants/t1",
        expect.objectContaining({ method: "PATCH" })
      );
    });
  });

  it("disables test button while in-flight", async () => {
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) =>
          setTimeout(
            () =>
              resolve({ ok: true, json: async () => ({}) } as Response),
            100
          )
        )
    );
    render(<ConnectionEditor tenant={tenant} />);
    const testBtn = screen.getByRole("button", { name: /Test Koneksi/i });
    fireEvent.click(testBtn);
    await waitFor(() => expect(testBtn).toBeDisabled());
  });
});
