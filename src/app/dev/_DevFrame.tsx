import { notFound } from "next/navigation";
import DevFetchStub from "./_DevFetchStub";

// Wraps every dev-only style guide page. (Deliberately not a layout.tsx:
// a layout only `next dev` can see makes the dev and production route type
// lists differ, which breaks type-checking after both have run.)
// Production builds don't include these pages at all (next.config
// pageExtensions); this check is a second line of defence.
export default function DevFrame({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <>
      {process.env.DELIVERY_UI_PREVIEW === "1" && (
        <style>{"nextjs-portal { display: none !important; }"}</style>
      )}
      <DevFetchStub />
      {children}
    </>
  );
}
