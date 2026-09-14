import { createWorkerInstanceId, ensureWorkerInstanceId } from '../src/worker-identity';

describe('worker instance identity', () => {
  test('includes process identity and a per-process nonce', () => {
    const first = createWorkerInstanceId({
      pipelineId: 'pipeline-a',
      host: 'shared-host',
      pid: 101,
      nonce: 'nonce-a',
    });
    const second = createWorkerInstanceId({
      pipelineId: 'pipeline-a',
      host: 'shared-host',
      pid: 202,
      nonce: 'nonce-b',
    });

    expect(first).toBe('pipeline-a-shared-host-101-nonce-a');
    expect(second).toBe('pipeline-a-shared-host-202-nonce-b');
    expect(first).not.toBe(second);
  });

  test('preserves an explicit operator-supplied instance id', () => {
    const env = { WORKER_INSTANCE_ID: 'explicit-fence' } as NodeJS.ProcessEnv;
    expect(ensureWorkerInstanceId(env)).toBe('explicit-fence');
    expect(env.WORKER_INSTANCE_ID).toBe('explicit-fence');
  });

  test('writes a generated process-unique id when none is supplied', () => {
    const env = {
      WORKER_ID: 'pipeline-a',
      HOSTNAME: 'shared-host',
    } as NodeJS.ProcessEnv;

    const instanceId = ensureWorkerInstanceId(env);

    expect(env.WORKER_INSTANCE_ID).toBe(instanceId);
    expect(instanceId).toMatch(/^pipeline-a-shared-host-\d+-[0-9a-f-]{36}$/i);
  });
});
