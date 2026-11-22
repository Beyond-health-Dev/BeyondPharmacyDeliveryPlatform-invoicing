// The fixture screens the style guide renders (and the screenshot script walks).
export const SCREENS = [
  { path: "home", label: "Store picker" },
  { path: "dashboard", label: "Dashboard" },
  { path: "orders", label: "Orders" },
  { path: "orders/new", label: "New order" },
  { path: "orders/new-anchor", label: "New order (Anchor, tomorrow)" },
  { path: "recurring", label: "Recurring" },
  { path: "reminders", label: "Reminders" },
  { path: "reminder-popup", label: "Reminder popup (over the dashboard)" },
  { path: "pricing", label: "Pricing" },
  { path: "invoices", label: "Invoices" },
  { path: "users", label: "Users" },
  { path: "deliveries", label: "Driver: deliveries" },
  { path: "deliver/o1", label: "Driver: delivery detail" },
  { path: "earnings", label: "Driver: earnings" },
] as const;
