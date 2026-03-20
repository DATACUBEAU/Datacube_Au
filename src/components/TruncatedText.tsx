'use client';

import { cn } from '@/lib/utils';

type TruncatedTextProps = {
  text: string;
  className?: string;
  /**
   * Tailwind max-width utility/classes.
   * Defaults are mobile‑first and can be overridden per usage.
   */
  maxWidthClass?: string;
};

export function TruncatedText({
  text,
  className,
  maxWidthClass = 'max-w-[140px] sm:max-w-[220px]',
}: TruncatedTextProps) {
  return (
    <span
      className={cn(
        'block min-w-0 truncate text-ellipsis overflow-hidden whitespace-nowrap',
        maxWidthClass,
        className,
      )}
      title={text}
    >
      {text}
    </span>
  );
}
