'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const PLAN_USAGE_TABS = [
  { href: '/dashboard/settings/subscription', label: 'Plan & billing' },
  { href: '/dashboard/settings/usage', label: 'Usage' },
] as const;

export function PlanUsageTabs() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Plan and usage settings"
      className="border-b border-border bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-6"
    >
      <div className="mx-auto flex max-w-6xl items-center justify-center gap-1 rounded-xl bg-muted/50 p-1 sm:w-fit">
        {PLAN_USAGE_TABS.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);

          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              className={`flex-1 rounded-lg px-4 py-2 text-center text-sm font-medium transition-colors sm:flex-none ${
                active
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-background hover:text-foreground'
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
