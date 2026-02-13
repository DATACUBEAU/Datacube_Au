'use client';

export function SystemBackground() {
  return (
    <div className="fixed inset-0 -z-50 pointer-events-none bg-background">
      {/* Static clean background for readability */}
      <div className="absolute inset-0 bg-neutral-50/50 dark:bg-neutral-950/50" />
      <div className="absolute inset-0 border-t border-border/20" />
    </div>
  );
}
