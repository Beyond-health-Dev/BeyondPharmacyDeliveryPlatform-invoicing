import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { resolveStore } from "@/lib/store";
import { vancouverTodayKey } from "@/lib/vancouverDate";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ store: string }> }
) {
  const { store: storeSlug } = await params;
  const store = await resolveStore(storeSlug);
  if (!store) {
    return NextResponse.json({ error: "Store not found" }, { status: 404 });
  }

  const session = await auth();
  if (!session?.user || session.user.role !== "PHARMACY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.user.storeId && session.user.storeId !== store.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const orders = await prisma.order.findMany({
    where: {
      storeId: store.id,
      status: { in: ["DELIVERED", "FAILED"] },
      isInvoiced: false,
    },
    orderBy: { scheduledDate: "asc" },
  });

  const header = "Date,Patient,Phone,Address,City,Zone,Price,Status";
  const rows = orders.map((o) => {
    const date = new Date(o.scheduledDate).toISOString().split("T")[0];
    const escape = (s: string | null) =>
      s ? `"${s.replace(/"/g, '""')}"` : "";
    return [
      date,
      escape(o.patientName),
      escape(o.patientPhone),
      escape(o.deliveryAddress),
      escape(o.deliveryCity),
      escape(o.deliveryZoneName),
      o.priceAtCreation.toFixed(2),
      o.status,
    ].join(",");
  });

  const csv = [header, ...rows].join("\n");
  const today = vancouverTodayKey();

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="uninvoiced-orders-${store.slug}-${today}.csv"`,
    },
  });
}
