import type { ReactNode } from "react";
import Image, { type StaticImageData } from "next/image";
import Link from "next/link";
import newOrderIcon from "@/assets/delivery-icons/new-order.webp";
import { cn } from "@/lib/portalStyles";

export default function DeliveryHero({
  title,
  artwork,
  storeSlug,
  children,
  className,
}: {
  title: string;
  artwork: StaticImageData;
  storeSlug: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("delivery-hero", className)}>
      <div className="delivery-hero-art" aria-hidden="true">
        <Image
          src={artwork}
          alt=""
          fill
          preload
          sizes="(max-width: 650px) 100vw, (max-width: 900px) 76vw, 840px"
        />
      </div>
      <div className="delivery-hero-content">
        {children}
        <h1>{title}</h1>
        <Link href={`/${storeSlug}/orders/new`} className="delivery-create portal-primary">
          <Image src={newOrderIcon} alt="" unoptimized draggable={false} className="delivery-create-icon" />
          New order
        </Link>
      </div>
    </header>
  );
}
