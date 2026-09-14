import { randomUUID } from 'crypto';
import { hostname } from 'os';

export function createWorkerInstanceId(input?: {
  pipelineId?: string;
  host?: string;
  pid?: number;
  nonce?: string;
}): string {
  const pipelineId = String(input?.pipelineId || process.env.WORKER_ID || process.env.PIPELINE_ID || 'vps-worker').trim() || 'vps-worker';
  const host = String(input?.host || process.env.HOSTNAME || hostname() || 'unknown-host').trim() || 'unknown-host';
  const pid = Number.isFinite(input?.pid) ? Number(input?.pid) : process.pid;
  const nonce = String(input?.nonce || randomUUID()).trim();
  return `${pipelineId}-${host}-${pid}-${nonce}`;
}

export function ensureWorkerInstanceId(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = String(env.WORKER_INSTANCE_ID || '').trim();
  if (explicit) return explicit;

  const instanceId = createWorkerInstanceId({
    pipelineId: env.WORKER_ID || env.PIPELINE_ID,
    host: env.HOSTNAME,
  });
  env.WORKER_INSTANCE_ID = instanceId;
  return instanceId;
}
