import { headers } from 'next/headers';
import type { ReactNode } from 'react';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export default async function ConexLayout({ children }: { children: ReactNode }) {
  await headers();

  return <>{children}</>;
}
