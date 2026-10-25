-- One-day calendar holds and week-long "Skip This Week" rows both lived in
-- RecurringOrderSkip, told apart only by date: any skip on a Sunday was read
-- as the whole week. Record which kind each row is.
--
-- Nullable on purpose: Vercel runs migrations when a build starts, while the
-- previous code is still serving. Rows it saves have no scope and are read with
-- the old rule (see recurringSkipScope in src/lib/recurringHolds.ts).
ALTER TABLE "RecurringOrderSkip" ADD COLUMN "scope" TEXT;

-- Skip This Week always saved the week's Sunday with this reason; everything
-- else came from the calendar's one-day hold.
UPDATE "RecurringOrderSkip"
SET "scope" = CASE
  WHEN EXTRACT(DOW FROM "skipDate") = 0 AND "reason" = 'Patient picked up in-store' THEN 'WEEK'
  ELSE 'DAY'
END;
