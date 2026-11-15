'use client';

import { createContext, useContext, useMemo } from 'react';
import type { UploadJobRow, CreateUploadJobInput } from '@/lib/upload/types';

type UploadJobsContextValue = {
  jobs: UploadJobRow[];
  activeJobs: UploadJobRow[];
  hasFailedJobs: boolean;
  hasCompletedJobs: boolean;
  isThrottled: boolean;
  maxUploadSize: number;
  setIsThrottled: (value: boolean) => void;
  enqueueUploads: (inputs: CreateUploadJobInput[]) => Promise<void>;
  cancelJob: (jobId: string) => Promise<void>;
  retryJob: (jobId: string) => Promise<void>;
  attachFileToJob: (jobId: string, file: File) => Promise<void>;
  removeJob: (jobId: string) => Promise<void>;
};

const UploadJobsContext = createContext<UploadJobsContextValue | null>(null);

const localOnlyError = () =>
  Object.assign(
    new Error('Cloud uploads and worker processing have been retired. Import and process documents in the AU app on your device.'),
    { code: 'DOCUMENTS_ARE_LOCAL', status: 410 },
  );

export function UploadJobsProvider({ children }: { children: React.ReactNode }) {
  const value = useMemo<UploadJobsContextValue>(() => ({
    jobs: [],
    activeJobs: [],
    hasFailedJobs: false,
    hasCompletedJobs: false,
    isThrottled: false,
    maxUploadSize: 0,
    setIsThrottled: () => undefined,
    enqueueUploads: async (_inputs) => { throw localOnlyError(); },
    cancelJob: async (_jobId) => undefined,
    retryJob: async (_jobId) => { throw localOnlyError(); },
    attachFileToJob: async (_jobId, _file) => { throw localOnlyError(); },
    removeJob: async (_jobId) => undefined,
  }), []);

  return (
    <UploadJobsContext.Provider value={value}>
      {children}
    </UploadJobsContext.Provider>
  );
}

export function useUploadJobs() {
  const context = useContext(UploadJobsContext);
  if (!context) {
    throw new Error('useUploadJobs must be used within UploadJobsProvider');
  }
  return context;
}
