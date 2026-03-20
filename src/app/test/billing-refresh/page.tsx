import { BillingRefreshHarness } from './harness';

export default function BillingRefreshHarnessPage() {
  if (process.env.NODE_ENV === 'production') {
    return null;
  }

  return <BillingRefreshHarness />;
}
