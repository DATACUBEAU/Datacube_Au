import { PlanUsageTabs } from '@/app/dashboard/settings/_components/plan-usage-tabs';

export default function SubscriptionLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PlanUsageTabs />
      {children}
    </>
  );
}
