# Delivery workspace V2 implementation plan for Opus

The draft implements the desktop redesign and the recurring calendar’s Weekly holds panel. Use the sequence below to review the implementation and verify it before release. The base includes the Anchor cancellation changes from PR #79 and the delivery label-sheet changes from PR #80.

## 1. Review the staff workspace

Start at `/dev/dashboard` and `/dev/orders`. Check the white background, flat moving circles, upright typography, transparent icons, and the original 3D truck on **On the road**. Both hero buttons should open the store’s existing order form. Check the Orders artwork and the soft rainbow button at a desktop width.

Follow a delivery’s **Track** link from the dashboard. The production page reads the HTTPS tracking URL stored by the signed Spoke webhook. The fixture opens a sample page. Check the waiting and unavailable states, the Anchor waiting-orders shortcut, cancellation notes, and the existing retry and cancel actions. Fees remain available on Orders and invoices.

The relevant entry points are `DeliveryHero.tsx`, `DashboardView.tsx`, the dashboard server page, `OrdersView.tsx`, and `src/styles/workspace.css`.

## 2. Trace the weekly hold records

Start with `src/app/api/[store]/recurring/calendar/route.ts` and `src/lib/weeklyHolds.ts`. Use the existing active profiles, delivery cadence, vacation dates and skip records for the selected store. The calendar requests the displayed Vancouver week, from Sunday inclusive to the following Sunday exclusive.

| Record | What staff should see |
| --- | --- |
| One-day hold | The recorded reason and the affected delivery date |
| Week skip | The saved reason once, with the scheduled delivery dates it affects |
| Vacation | **Vacation hold** on the scheduled dates within its inclusive range |
| Overlap | Each applicable reason under the same patient and its own dates |
| Missing note | **No reason recorded** for a day or week skip without a saved reason |

A combined Sunday record keeps the Sunday note. Show that note only for Sunday. Vacation profiles store a date range and a hold flag. Use the vacation label for these records. Group linked profiles by patient ID and legacy unlinked records by recurring profile ID. Show an address to distinguish separate entries that share a name.

The calendar read, hold, resume and profile update routes use the existing store-admin guard. The response is private and uncached. This PR uses the existing database schema.

## 3. Follow the calendar interaction

Open `/dev/recurring` and select **Weekly holds** at the lower right. The count is the number of patients with held deliveries. The grid’s summary counts delivery occurrences. The panel always covers all drivers in the selected week, and opening it requests current calendar data.

Trace the UI through `RecurringView.tsx`, `RecurringCalendar.tsx`, and `WeeklyHolds.tsx`. Successful calendar and profile-list actions refresh the same week. Preserve the selected week and driver during that refresh. A request from an earlier week must never populate a later week’s panel. Keep the seven-column calendar, label rearrangement, and daily print actions available.

## 4. Verify the release candidate

1. Give one sample patient two one-day holds with different reasons. Open the tab and confirm one patient entry, both notes and their dates. Filter the grid to another driver and confirm the panel still lists both.
2. Resume one day, then the other. Confirm each affected date disappears and the count drops after the last hold. Repeat from the profile list with **Skip This Week**, **Unskip**, **Vacation Hold**, and **Remove Hold**.
3. Visit adjacent weeks, including an empty week. Check that a future vacation starts on its chosen date and that off-cycle biweekly deliveries are absent. Retry a failed calendar read and confirm the earlier list never appears under the new week.
4. Open the tab with the keyboard. Read and scroll a long list, then dismiss it with Escape, the close button or an outside click. Open **Rearrange labels** and verify its existing controls still work.
5. Run the checks below. The route tests exercise store access, and the weekly-holds tests cover matching dates, overlapping reasons, linked profiles and namesakes. For a database-backed review, use fictional records in a test store.

```sh
npx prisma generate
npm run lint
npx tsc --noEmit --incremental false
npm test
npx next build --webpack
```

For the interactive fixture, run `npm run dev -- --hostname 127.0.0.1 --port 3100` and open `/dev/recurring`. Sample hold changes last for that browser tab until reload.
