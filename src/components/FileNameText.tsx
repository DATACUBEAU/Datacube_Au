'use client';

import { TruncatedText } from '@/components/TruncatedText';
import { cn } from '@/lib/utils';

type FileNameTextProps = {
  text: string;
  className?: string;
  maxWidthClass?: string;
};

export function FileNameText({
  text,
  className,
  maxWidthClass = 'max-w-full',
}: FileNameTextProps) {
  return (
    <TruncatedText
      text={text}
      preserveExtension
      maxWidthClass={maxWidthClass}
      className={cn('min-w-0 flex-1', className)}
    />
  );
}
