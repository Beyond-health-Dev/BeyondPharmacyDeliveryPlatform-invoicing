"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import {
  ArrowUpRight,
  Bell,
  Building2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Menu,
  ReceiptText,
  Repeat2,
  Tags,
  Truck,
  UsersRound,
  X,
} from "lucide-react";
import logo from "@/assets/beyond-pharmacy-logo.png";

const navigation = [
  {
    label: "Operations",
    sections: [
      { path: "dashboard", label: "Dashboard", icon: LayoutDashboard },
      { path: "orders", label: "Orders", icon: ClipboardList },
      { path: "recurring", label: "Recurring", icon: Repeat2 },
      { path: "reminders", label: "Reminders", icon: Bell },
    ],
  },
  {
    label: "Management",
    sections: [
      { path: "invoices", label: "Invoices", icon: ReceiptText },
      { path: "pricing", label: "Pricing", icon: Tags },
      { path: "users", label: "Users", icon: UsersRound },
    ],
  },
];

const stores = [
  { slug: "surrey", label: "Surrey" },
  { slug: "abbotsford", label: "Abbotsford" },
];

const spokeUrl =
  "https://connect.spoke.com/orders?sortField=createdAt&sortDirection=descending";

export default function PharmacyNav({
  storeSlug,
  storeName,
  basePath,
}: {
  storeSlug: string;
  storeName: string;
  basePath?: string;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileToggle = useRef<HTMLButtonElement>(null);
  const base = basePath ?? "/" + storeSlug;
  const dashboardHref = base + "/dashboard";
  const isPreview = basePath === "/dev";
  const storeLabel = stores.find((store) => store.slug === storeSlug)?.label ?? storeName;
  const otherStores = stores.filter((store) => store.slug !== storeSlug);
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  // Escape closes the open menu wherever focus is, and hands focus back to
  // its button. A dialog or popover on top handles its own Escape.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (event.target instanceof Element && event.target.closest('[role="dialog"], [aria-modal="true"]')) return;
      setMobileOpen(false);
      mobileToggle.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen]);

  const activeSection = navigation
    .flatMap(({ sections }) => sections)
    .find(({ path }) => isActive(base + "/" + path));
  const pageLabel = pathname === base + "/orders/new"
    ? "New order"
    : activeSection?.label ?? (isPreview ? "Style guide" : storeLabel);
  const locationLabel = (
    <>
      <span className="workspace-location-icon"><Building2 size={17} aria-hidden="true" /></span>
      <span className="workspace-location-name">
        <strong>{storeLabel}</strong>
        <small>Pharmacy location</small>
      </span>
    </>
  );

  return (
    <>
      <a href="#workspace-content" className="workspace-skip-link">Skip to content</a>
      <header className="workspace-topbar">
        <div className="workspace-topbar-start">
          <button
            ref={mobileToggle}
            type="button"
            className="workspace-icon-button workspace-menu-button"
            aria-expanded={mobileOpen}
            aria-controls="pharmacy-sidebar"
            aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
            onClick={() => setMobileOpen((open) => !open)}
          >
            {mobileOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
          </button>
          <div className="workspace-breadcrumb">
            <span>Delivery workspace</span>
            <ChevronRight size={14} aria-hidden="true" />
            <strong>{pageLabel}</strong>
          </div>
        </div>
        <div className="workspace-topbar-end">
          {isPreview && <span className="workspace-preview">Sample data</span>}
          <Link
            href={dashboardHref + "#delivery-activity"}
            className="workspace-icon-button"
            aria-label="View dashboard activity"
            onClick={() => setMobileOpen(false)}
          >
            <Bell size={19} aria-hidden="true" />
          </Link>
        </div>
      </header>
      <aside
        id="pharmacy-sidebar"
        className="workspace-sidebar"
        data-open={mobileOpen}
      >
        <Link href={dashboardHref} className="workspace-brand" onClick={() => setMobileOpen(false)}>
          <Image src={logo} alt="Beyond Pharmacy" preload />
          <span>Delivery operations</span>
        </Link>
        {isPreview || otherStores.length === 0 ? (
          <div className="workspace-location">{locationLabel}</div>
        ) : (
          <details className="workspace-switcher">
            <summary className="workspace-location">
              {locationLabel}
              <ChevronDown size={15} aria-hidden="true" />
            </summary>
            <div className="workspace-store-menu">
              {otherStores.map((store) => (
                <Link
                  key={store.slug}
                  href={"/" + store.slug + "/dashboard"}
                  className="workspace-nav-link"
                  onClick={() => setMobileOpen(false)}
                >
                  Switch to {store.label}
                  <ChevronRight size={14} aria-hidden="true" />
                </Link>
              ))}
            </div>
          </details>
        )}

        <nav aria-label="Pharmacy navigation" className="workspace-nav">
          {navigation.map(({ label, sections }) => (
            <div className="workspace-nav-group" key={label}>
              <p>{label}</p>
              {sections.map(({ path, label, icon: Icon }) => {
                const href = base + "/" + path;
                return (
                  <Link
                    key={path}
                    href={href}
                    aria-current={pathname === href ? "page" : isActive(href) ? "location" : undefined}
                    className="workspace-nav-link"
                    onClick={() => setMobileOpen(false)}
                  >
                    <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
                    {label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="workspace-sidebar-footer">
          <a href={spokeUrl} target="_blank" rel="noreferrer" className="workspace-nav-link">
            <Truck size={18} strokeWidth={1.8} aria-hidden="true" />
            Spoke dispatch
            <ArrowUpRight size={14} className="workspace-external-icon" aria-label="Opens in a new tab" />
          </a>
          {isPreview ? (
            <Link href="/login" className="workspace-nav-link" onClick={() => setMobileOpen(false)}>
              <LogOut size={18} strokeWidth={1.8} aria-hidden="true" /> Sign-in screen
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="workspace-nav-link"
            >
              <LogOut size={18} strokeWidth={1.8} aria-hidden="true" /> Sign out
            </button>
          )}
        </div>
      </aside>
    </>
  );
}
