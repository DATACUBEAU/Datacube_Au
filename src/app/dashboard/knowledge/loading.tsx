'use client';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Wand2 } from 'lucide-react';

const KnowledgeLoading = () => {
  return (
    <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-center">
        <Skeleton className="h-9 w-48" />
        <div className="flex w-full flex-col gap-2 sm:flex-row md:ml-auto md:w-auto">
          <Skeleton className="h-10 w-full md:w-[250px]" />
          <Skeleton className="h-10 w-full sm:w-28" />
        </div>
      </div>
      <div className="mt-4 flex-1">
        <div className="flex h-full min-h-[400px] flex-col items-center justify-center">
          <div className="space-y-2 text-center text-muted-foreground">
            <Wand2 className="mx-auto h-10 w-10 text-primary/30" />
            <p className="text-lg font-semibold">Ready to unlock A U insights?</p>
            <p>Click 'Generate' to begin.</p>
          </div>
        </div>
      </div>
    </main>
  );
};

export default KnowledgeLoading;
