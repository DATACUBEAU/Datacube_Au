import Link from 'next/link';

export default function SubscriptionLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="border-b border-border bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-6">
        <div className="mx-auto flex max-w-6xl items-center justify-center gap-1 rounded-xl bg-muted/50 p-1 sm:w-fit">
          <Link
            href="/dashboard/settings/subscription"
            className="flex-1 rounded-lg bg-background px-4 py-2 text-center text-sm font-medium text-foreground shadow-sm sm:flex-none"
          >
            Plan & billing
          </Link>
          <Link
            href="/dashboard/settings/usage"
            className="flex-1 rounded-lg px-4 py-2 text-center text-sm font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground sm:flex-none"
          >
            Usage
          </Link>
        </div>
      </div>
      {children}
    </>
  );
}
