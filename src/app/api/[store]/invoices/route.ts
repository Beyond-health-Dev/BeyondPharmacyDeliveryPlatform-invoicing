import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { resolveStore } from "@/lib/store";
import { invoiceNumberPrefix } from "@/lib/vancouverDate";

export async function POST(
  req: NextRequest,
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

  const { periodStart, periodEnd, driverId } = await req.json();

  if (!periodStart || !periodEnd) {
    return NextResponse.json(
      { error: "periodStart and periodEnd are required" },
      { status: 400 }
    );
  }
  if (!driverId) {
    return NextResponse.json(
      { error: "driverId is required — one invoice per driver" },
      { status: 400 }
    );
  }

  // Resolve driver: "unassigned" => null FK; any other value must be a
  // DRIVER belonging to this store.
  let persistedDriverId: string | null;
  let driverName: string;
  if (driverId === "unassigned") {
    persistedDriverId = null;
    driverName = "Unassigned";
  } else {
    const driver = await prisma.user.findFirst({
      where: { id: driverId, role: "DRIVER", storeId: store.id },
      select: { id: true, name: true },
    });
    if (!driver) {
      return NextResponse.json({ error: "Invalid driver" }, { status: 400 });
    }
    persistedDriverId = driver.id;
    driverName = driver.name;
  }

  // Include both DELIVERED and FAILED orders that haven't been invoiced yet,
  // scoped to this driver's deliveries only. Fetch → claim → create runs inside
  // one transaction; the claim (updateMany guarded on isInvoiced: false) is the
  // concurrency gate — if a parallel generation already took any of these
  // orders, the claimed count won't match and we abort instead of double-billing.
  const invoice = await prisma
    .$transaction(async (tx) => {
      const orders = await tx.order.findMany({
        where: {
          storeId: store.id,
          status: { in: ["DELIVERED", "FAILED"] },
          isInvoiced: false,
          scheduledDate: {
            gte: new Date(periodStart),
            lte: new Date(periodEnd + "T23:59:59.999Z"),
          },
          assignedDriverId: persistedDriverId,
        },
        orderBy: { scheduledDate: "asc" },
      });

      if (orders.length === 0) return null;

      const claimed = await tx.order.updateMany({
        where: { id: { in: orders.map((o) => o.id) }, isInvoiced: false },
        data: { isInvoiced: true },
      });
      if (claimed.count !== orders.length) {
        throw new Error("INVOICE_CONFLICT");
      }

      const totalAmount = orders.reduce((sum, o) => sum + o.priceAtCreation, 0);

      // Generate invoice number
      const prefix = invoiceNumberPrefix();
      const count = await tx.invoice.count({
        where: {
          invoiceNumber: { startsWith: prefix },
          storeId: store.id,
        },
      });
      const invoiceNumber = `${prefix}-${String(count + 1).padStart(3, "0")}`;

      return tx.invoice.create({
        data: {
          invoiceNumber,
          periodStart: new Date(periodStart),
          periodEnd: new Date(periodEnd),
          totalAmount,
          driverId: persistedDriverId,
          generatedById: session.user.id,
          storeId: store.id,
          lineItems: {
            create: orders.map((order) => ({
              orderId: order.id,
              description: `${order.status === "FAILED" ? "Attempted delivery" : "Delivery"} to ${order.deliveryAddress}, ${order.deliveryCity} (${order.deliveryZoneName})`,
              amount: order.priceAtCreation,
            })),
          },
        },
        include: { lineItems: true },
      });
    })
    .catch((err: unknown) => {
      if (err instanceof Error && err.message === "INVOICE_CONFLICT") {
        return "CONFLICT" as const;
      }
      throw err;
    });

  if (invoice === "CONFLICT") {
    return NextResponse.json(
      { error: "Another invoice generation was already processing these orders. Please refresh and try again." },
      { status: 409 }
    );
  }

  if (!invoice) {
    return NextResponse.json(
      { error: `No delivered/attempted orders found for ${driverName} in this period` },
      { status: 400 }
    );
  }

  return NextResponse.json(invoice, { status: 201 });
}
