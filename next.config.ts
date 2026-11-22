import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'none'",
  "media-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "navigate-to 'self'",
].join("; ");

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: contentSecurityPolicy,
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Cross-Origin-Opener-Policy",
    value: "same-origin",
  },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), fullscreen=(self)",
  },
];

const nextConfig: NextConfig = {
  serverExternalPackages: ["node-cron"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

// The dev-only style guide lives in src/app/dev as *.dev.tsx files. Only
// `next dev` treats that extension as a page, so production builds don't
// contain the route at all. "ts"/"tsx" stay in both lists because this
// setting also governs proxy.ts and instrumentation.ts.
export default function config(phase: string): NextConfig {
  const isDevelopment = phase === PHASE_DEVELOPMENT_SERVER;
  return {
    ...nextConfig,
    ...(isDevelopment && process.env.DELIVERY_UI_PREVIEW === "1" ? { devIndicators: false } : {}),
    pageExtensions:
      isDevelopment
        ? ["dev.tsx", "tsx", "ts", "jsx", "js"]
        : ["tsx", "ts", "jsx", "js"],
  };
}
