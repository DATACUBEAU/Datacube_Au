'use client';
import { Skeleton } from '@/components/ui/skeleton';
import { SquarePen } from 'lucide-react';

const PracticeLoading = () => {
  return (
    <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-center">
        <Skeleton className="h-9 w-40" />
        <div className="flex w-full flex-col gap-2 sm:flex-row md:ml-auto md:w-auto">
          <Skeleton className="h-10 w-full md:w-[250px]" />
          <Skeleton className="h-10 w-full sm:w-[150px]" />
        </div>
      </div>
      <div className="flex-1 rounded-xl border bg-card text-card-foreground shadow flex flex-col justify-center mt-4">
        <div className="flex flex-col items-center justify-center text-center h-full min-h-[400px]">
          <SquarePen className="h-12 w-12 text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold">Practice Exam Center</h2>
          <p className="text-muted-foreground max-w-md mx-auto mt-2">
            Select one of your completed documents and let the AU generate a practice exam to test your knowledge.
          </p>
        </div>
      </div>
    </main>
  );
};

export default PracticeLoading;
