import { headers } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

const items = [
  { href: '/conex', label: 'Admin' },
  { href: '/conex/usage', label: 'User usage' },
  { href: '/conex/plan-limits', label: 'Plan limits' },
] as const;

export default async function ConexLayout({ children }: { children: ReactNode }) {
  await headers();

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-40 border-b border-border bg-background/95 px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/85 sm:px-5">
        <nav aria-label="Conex administration" className="mx-auto flex max-w-7xl gap-1 overflow-x-auto rounded-xl bg-muted/50 p-1">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground hover:shadow-sm"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
      {children}
    </div>
  );
}
