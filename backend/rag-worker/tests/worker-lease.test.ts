import { assertWorkerLeaseOwnership, WorkerLeaseLostError } from '../src/worker-lease';

function makeSupabase(response: { data: any; error: any }) {
  const filters: Array<[string, unknown]> = [];
  const query = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn((column: string, value: unknown) => {
      filters.push([column, value]);
      return query;
    }),
    maybeSingle: jest.fn().mockResolvedValue(response),
  };
  return { supabase: { from: jest.fn(() => query) }, filters, query };
}

describe('durable worker lease guard', () => {
  test('requires the exact processing job owner and an unexpired lease', async () => {
    const { supabase, filters } = makeSupabase({
      data: { id: 'job-1', locked_until: new Date(Date.now() + 60000).toISOString() },
      error: null,
    });
    await assertWorkerLeaseOwnership(supabase as any, 'job-1', 'worker-a');
    expect(filters).toEqual([
      ['id', 'job-1'],
      ['status', 'processing'],
      ['claimed_by', 'worker-a'],
    ]);
  });

  test('classifies an absent/reclaimed job as lease loss', async () => {
    const { supabase } = makeSupabase({ data: null, error: null });
    await expect(assertWorkerLeaseOwnership(supabase as any, 'job-2', 'worker-a'))
      .rejects.toBeInstanceOf(WorkerLeaseLostError);
  });

  test('rejects an expired durable lease even if the owner column still matches', async () => {
    const { supabase } = makeSupabase({
      data: { id: 'job-3', locked_until: new Date(Date.now() - 1000).toISOString() },
      error: null,
    });
    await expect(assertWorkerLeaseOwnership(supabase as any, 'job-3', 'worker-a'))
      .rejects.toBeInstanceOf(WorkerLeaseLostError);
  });

  test('propagates datastore errors instead of pretending they are ownership loss', async () => {
    const dbError = { code: '08006', message: 'connection timeout' };
    const { supabase } = makeSupabase({ data: null, error: dbError });
    await expect(assertWorkerLeaseOwnership(supabase as any, 'job-4', 'worker-a'))
      .rejects.toBe(dbError);
  });
});
