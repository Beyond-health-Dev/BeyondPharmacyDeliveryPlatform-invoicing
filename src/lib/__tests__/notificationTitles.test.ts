import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NOTIFICATION_TITLES, notificationTitle } from "@/lib/statusTheme";

// Every kind of store notification the app creates, read from the source
// (prisma.notification.create / tx.notification.create calls).
const srcDir = fileURLToPath(new URL("../../", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "__tests__" ? [] : sourceFiles(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

function createdTypes() {
  const types = new Set<string>();
  for (const file of sourceFiles(srcDir)) {
    const text = readFileSync(file, "utf8");
    for (const call of text.matchAll(/\bnotification\.create\(\{/g)) {
      const type = text.slice(call.index, call.index + 600).match(/\btype:\s*"([A-Z_]+)"/);
      if (!type) throw new Error(`No literal type in the notification created in ${path.relative(srcDir, file)}`);
      types.add(type[1]);
    }
  }
  return [...types].sort();
}

describe("notification titles", () => {
  it("finds the kinds the app creates", () => {
    expect(createdTypes()).toEqual(
      expect.arrayContaining(["DELIVERY_FAILED", "SPOKE_CANCEL_INCOMPLETE", "SPOKE_DISPATCH_FAILED", "DELIVERY_REATTEMPT"])
    );
  });

  it("gives every kind the app creates its own title", () => {
    const missing = createdTypes().filter((type) => !(type in NOTIFICATION_TITLES));
    expect(missing).toEqual([]);
  });

  it("keeps the titles staff already know, and names the Anchor cleanup alert", () => {
    expect(notificationTitle("DELIVERY_FAILED")).toBe("Delivery Failed");
    expect(notificationTitle("DELIVERY_REATTEMPT")).toBe("Re-attempt Started");
    expect(notificationTitle("SPOKE_DISPATCH_FAILED")).toBe("Spoke Dispatch Failed");
    expect(notificationTitle("SPOKE_DISPATCH_STALLED")).toBe("Spoke Delivery Stalled");
    expect(notificationTitle("GENERATION_INCOMPLETE")).toBe("Generation Incomplete");
    expect(notificationTitle("ORDER_PICKED_UP")).toBe("Order Picked Up");
    expect(notificationTitle("BATCH_DELIVERED")).toBe("Batch Delivered");
    expect(notificationTitle("SPOKE_CANCEL_INCOMPLETE")).toBe("Remove from Anchor");
  });

  it("falls back to a neutral title", () => {
    expect(notificationTitle("SOMETHING_NEW")).toBe("Notice");
  });
});
