import { DM_Sans } from "next/font/google";

// Self-hosted at build time by next/font, so the CSP (font-src 'self') holds.
// Shared by the root layout and the global error screen (which replaces the
// root layout, so it has to load the font itself).
export const dmSans = DM_Sans({
  subsets: ["latin"],
  display: "swap",
  style: "normal",
  variable: "--font-dm-sans",
});
