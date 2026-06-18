// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { ConnectionEditor } from "./connection-editor";

const baseTenant = {
  id: "t1",
  name: "Test University",
  slug: "test-uni",
  status: "connected",
  ed25519PublicKey: null,
  ed25519RotatedAt: null,
  lastPullAt: null,
  lastPullStatus: null,
  lastPullError: null,
} as any;

beforeEach(() => {
  // Stub fetch globally — the component calls router.refresh which may fetch
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
});

describe("ConnectionEditor last sync indicator", () => {
  it("shows 'never synced' when lastPullAt is null", () => {
    render(<ConnectionEditor tenant={baseTenant} />);
    expect(screen.getByTestId("last-sync-never")).toBeInTheDocument();
    expect(screen.getByText(/belum pernah disinkronkan/i)).toBeInTheDocument();
  });

  it("shows success indicator when lastPullStatus is 'ok'", () => {
    render(
      <ConnectionEditor
        tenant={{
          ...baseTenant,
          lastPullAt: new Date().toISOString(),
          lastPullStatus: "ok",
        }}
      />
    );
    expect(screen.getByTestId("last-sync-ok")).toBeInTheDocument();
    expect(screen.getByText(/sinkron terakhir/i)).toBeInTheDocument();
  });

  it("shows failed indicator when lastPullStatus is 'failed' with error", () => {
    render(
      <ConnectionEditor
        tenant={{
          ...baseTenant,
          lastPullAt: new Date().toISOString(),
          lastPullStatus: "failed",
          lastPullError: "Connection refused",
        }}
      />
    );
    expect(screen.getByTestId("last-sync-failed")).toBeInTheDocument();
    expect(screen.getByText(/gagal/i)).toBeInTheDocument();
  });

  it("renders the Pull Now button", () => {
    render(<ConnectionEditor tenant={baseTenant} />);
    expect(screen.getByTestId("pull-now-button")).toBeInTheDocument();
    expect(screen.getByText(/tarik data sekarang/i)).toBeInTheDocument();
  });
});
