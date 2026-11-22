"use client";

import { useSyncExternalStore, type ComponentProps } from "react";
import RecurringView from "@/app/(pharmacy)/[store]/recurring/RecurringView";
import { previewProfiles, subscribeToPreview } from "./_recurringPreview";
import { recurringOrders } from "./_fixtures";

export default function DevRecurringView(props: Omit<ComponentProps<typeof RecurringView>, "orders">) {
  const orders = useSyncExternalStore(subscribeToPreview, previewProfiles, () => recurringOrders);
  return <RecurringView {...props} orders={orders} />;
}
