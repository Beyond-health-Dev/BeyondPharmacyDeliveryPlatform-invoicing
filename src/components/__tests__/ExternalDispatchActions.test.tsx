import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/components/ui/DialogsProvider", () => ({ useConfirm: () => vi.fn(async () => true) }));
vi.mock("@/components/ui/ToastProvider", () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }),
}));

import ExternalDispatchActions from "@/components/ExternalDispatchActions";

function render(props: Partial<Parameters<typeof ExternalDispatchActions>[0]> = {}) {
  return renderToStaticMarkup(
    <ExternalDispatchActions
      dispatchId="d1"
      currentStatus="DISPATCH_FAILED"
      canCancel
      storeSlug="surrey"
      patientName="Riley Chen"
      {...props}
    />
  );
}

const buttons = (html: string) => [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);

describe("ExternalDispatchActions", () => {
  it("offers Retry and Cancel on a failed send that can be cancelled", () => {
    const html = render();

    expect(buttons(html)).toEqual(["Retry", "Cancel"]);
    expect(html).toContain('aria-label="Retry order for Riley Chen"');
    expect(html).toContain('aria-label="Cancel order for Riley Chen"');
    // Focusable while nothing runs, and never the disabled attribute.
    expect(html).toContain('aria-disabled="false"');
    expect(html).not.toMatch(/\sdisabled=/);
  });

  it("offers only Cancel on a held order", () => {
    const html = render({ currentStatus: "SCHEDULED" });

    expect(buttons(html)).toEqual(["Cancel"]);
    expect(html).toContain('aria-label="Cancel order for Riley Chen"');
  });

  it("offers neither once Anchor has the order, showing what an in-house row shows", () => {
    expect(buttons(render({ currentStatus: "ALLOCATED", canCancel: false }))).toEqual([]);
    expect(render({ currentStatus: "ALLOCATED", canCancel: false })).not.toContain("External handoff");
    expect(render({ currentStatus: "ALLOCATED", canCancel: false, noAction: <span>-</span> })).toContain("<span>-</span>");
  });

  it("keeps a focus target in the cell whatever it shows", () => {
    for (const currentStatus of ["DISPATCH_FAILED", "SCHEDULED", "ALLOCATED", "CANCELLED"]) {
      expect(render({ currentStatus })).toMatch(/^<div tabindex="-1"/);
    }
  });

  it("uses the navy link for Retry on a failed (blush) row", () => {
    const html = render({ onAttentionRow: true });
    expect(html).toMatch(/<button[^>]*class="[^"]*text-navy[^"]*"[^>]*>Retry</);
    expect(render()).toMatch(/<button[^>]*class="[^"]*text-green-link[^"]*"[^>]*>Retry</);
  });
});
