import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { resolveStore } from "@/lib/store";

export async function GET(
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

  const start = req.nextUrl.searchParams.get("start");
  const end = req.nextUrl.searchParams.get("end");
  const driverIdParam = req.nextUrl.searchParams.get("driverId");

  if (!start || !end) {
    return NextResponse.json({ error: "Start and end dates required" }, { status: 400 });
  }
  if (!driverIdParam) {
    return NextResponse.json({ error: "driverId is required" }, { status: 400 });
  }

  // "unassigned" selects orders without a driver; any other value is a user id
  // that must belong to a DRIVER in this store.
  let assignedDriverFilter: { assignedDriverId: string | null };
  let driverName = "Unassigned";
  if (driverIdParam === "unassigned") {
    assignedDriverFilter = { assignedDriverId: null };
  } else {
    const driver = await prisma.user.findFirst({
      where: {
        id: driverIdParam,
        role: "DRIVER",
        storeId: store.id,
      },
      select: { id: true, name: true },
    });
    if (!driver) {
      return NextResponse.json({ error: "Invalid driver" }, { status: 400 });
    }
    assignedDriverFilter = { assignedDriverId: driver.id };
    driverName = driver.name;
  }

  // Include both DELIVERED and FAILED orders that haven't been invoiced yet
  const orders = await prisma.order.findMany({
    where: {
      storeId: store.id,
      status: { in: ["DELIVERED", "FAILED"] },
      isInvoiced: false,
      scheduledDate: {
        gte: new Date(start),
        lte: new Date(end + "T23:59:59.999Z"),
      },
      ...assignedDriverFilter,
    },
    orderBy: { scheduledDate: "asc" },
  });

  const total = orders.reduce((sum, o) => sum + o.priceAtCreation, 0);

  return NextResponse.json({
    driverName,
    orders: orders.map((o) => ({
      id: o.id,
      patientName: o.patientName,
      address: `${o.deliveryAddress}, ${o.deliveryCity}`,
      zone: o.deliveryZoneName,
      price: o.priceAtCreation,
      date: new Date(o.scheduledDate).toLocaleDateString("en-US", { timeZone: "UTC" }),
      status: o.status,
    })),
    total,
  });
}
