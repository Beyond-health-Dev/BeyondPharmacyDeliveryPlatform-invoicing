-- Staff can move a recurring profile to a different delivery label sheet, or
-- put it on several. The choice is kept apart from the delivery days, as JSON
-- text such as '["monday","thursday"]'.
--
-- Nullable on purpose, with no default or backfill: Vercel runs migrations
-- when a build starts, while the previous code is still serving and ignores
-- this column. Null means automatic (the sheet the delivery days give).
ALTER TABLE "RecurringOrder" ADD COLUMN "labelSheets" TEXT;
