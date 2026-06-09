"use client";

import Link from "next/link";
import { BookOpen, CalendarDays, Map as MapIcon, Route, Settings } from "lucide-react";
import type { MemoryNavKey } from "@/components/MemoryNav";

const mobileNavItems = [
  { key: "map", label: "地图", icon: MapIcon, href: "/map" },
  { key: "memories", label: "回忆", icon: BookOpen, href: "/memories" },
  { key: "trips", label: "攻略", icon: Route, href: "/trips" },
  { key: "anniversaries", label: "纪念日", icon: CalendarDays, href: "/anniversaries" },
  { key: "settings", label: "设置", icon: Settings, href: "/settings" },
] satisfies Array<{
  key: MemoryNavKey;
  label: string;
  icon: typeof MapIcon;
  href: string;
}>;

export default function MobileAppNav({ active }: Readonly<{ active: MemoryNavKey }>) {
  return (
    <nav className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+0.5rem)] z-[70] grid grid-cols-5 gap-1 rounded-[14px] border border-[#D8DDD8]/82 bg-[#FAFBF7]/92 p-1.5 shadow-[0_18px_44px_rgba(90,102,112,0.16)] backdrop-blur-xl lg:hidden">
      {mobileNavItems.map((item) => {
        const Icon = item.icon;
        const selected = item.key === active;
        return (
          <Link
            key={item.key}
            className={`flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-[11px] text-[11px] font-semibold transition ${
              selected
                ? "bg-[#F5DCE0] text-[#D86F82] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]"
                : "text-[#5A6670]/62 hover:bg-white/60"
            }`}
            href={item.href}
            aria-current={selected ? "page" : undefined}
          >
            <Icon className="h-4 w-4" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
