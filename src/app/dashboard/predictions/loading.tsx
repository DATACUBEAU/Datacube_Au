'use client';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { BrainCircuit, AlertTriangle } from 'lucide-react';

const PredictionsLoading = () => {
  return (
    <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
      <div className="grid gap-4">
        <div>
          <Skeleton className="h-9 w-64 mb-2" />
          <Skeleton className="h-5 w-80" />
        </div>
        <Alert>
          <BrainCircuit className="h-4 w-4" />
          <AlertTitle>How It Works</AlertTitle>
          <AlertDescription>
            Select your past questions and main textbook. The AU analyzes both to identify exam patterns, predict likely topics, and highlight common mistakes. All predictions are grounded strictly in your materials.
          </AlertDescription>
        </Alert>
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Disclaimer</AlertTitle>
          <AlertDescription>
            Predictions are generated based on document analysis and aim for high accuracy. However, they should be used as a study guide and are not guaranteed to appear on your exam.
          </AlertDescription>
        </Alert>
        <div className="grid grid-cols-1 md:grid-cols-[1fr,1fr,auto] gap-4 items-end">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-10" />
        </div>
      </div>
      <div className="flex h-[400px] items-center justify-center rounded-lg border border-dashed mt-4">
        <p className="text-muted-foreground">Please select your documents above.</p>
      </div>
    </main>
  );
};

export default PredictionsLoading;
