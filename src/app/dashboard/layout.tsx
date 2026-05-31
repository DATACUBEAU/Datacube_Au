import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import DashboardClientLayout from './dashboard-client-layout';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  await headers();

  return <DashboardClientLayout>{children}</DashboardClientLayout>;
}
