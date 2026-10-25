"use client";

import {
  card,
  cn,
  emptyState,
  linkButton,
  sectionTitle,
  statusBadgeClasses,
  tableHeader,
  tableRow,
  totalPill,
} from "@/lib/portalStyles";

interface InvoiceItem {
  id: string;
  invoiceNumber: string;
  periodStart: string;
  periodEnd: string;
  totalAmount: number;
  status: string;
  lineItemCount: number;
  createdAt: string;
  generatedBy: string;
  driverName: string | null;
}

// Period dates are stored as UTC midnights; read in the browser's own time
// zone (Pacific) they showed a day early.
function formatPeriodDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", { timeZone: "UTC" });
}

export default function InvoiceList({
  invoices,
  storeSlug,
}: {
  invoices: InvoiceItem[];
  storeSlug: string;
}) {
  const downloadPdf = async (invoiceId: string) => {
    const res = await fetch(`/api/${storeSlug}/invoices/${invoiceId}/pdf`);
    if (res.ok) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `invoice-${invoiceId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  return (
    <div className={`${card} overflow-hidden`}>
      <div className="px-6 py-4 border-b border-hairline">
        <h2 className={sectionTitle}>Generated Invoices</h2>
      </div>
      {invoices.length === 0 ? (
        <div className={cn(emptyState, "m-4")}>
          No invoices <span className="text-navy">generated</span> yet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className={tableHeader}>
              <tr>
                <th className="px-6 py-3">Invoice #</th>
                <th className="px-6 py-3">Driver</th>
                <th className="px-6 py-3">Period</th>
                <th className="px-6 py-3">Items</th>
                <th className="px-6 py-3">Total</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {invoices.map((inv) => (
                <tr key={inv.id} className={tableRow}>
                <td className="px-6 py-4 text-sm font-semibold text-navy">{inv.invoiceNumber}</td>
                <td className="px-6 py-4 text-sm text-ink">
                  {inv.driverName ?? <span className="text-muted">All drivers</span>}
                </td>
                <td className="px-6 py-4 text-sm text-ink tabular-nums">
                  {formatPeriodDate(inv.periodStart)} – {formatPeriodDate(inv.periodEnd)}
                </td>
                <td className="px-6 py-4 text-sm text-ink tabular-nums">{inv.lineItemCount}</td>
                <td className="px-6 py-4 text-sm">
                  <span className={totalPill.total}>${inv.totalAmount.toFixed(2)}</span>
                </td>
                <td className="px-6 py-4">
                  <span className={statusBadgeClasses(inv.status)}>
                    {inv.status}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <button onClick={() => downloadPdf(inv.id)} className={cn(linkButton, "text-xs")}>Download PDF</button>
                </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
