import { headers } from 'next/headers';
import type { ReactNode } from 'react';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

/**
 * Keep the Conex route shell neutral. The authenticated admin page owns its
 * navigation; rendering route navigation here exposed it behind the
 * multi-stage verification screen.
 */
export default async function ConexLayout({ children }: { children: ReactNode }) {
  await headers();
  return <div className="min-h-screen bg-background">{children}</div>;
}
