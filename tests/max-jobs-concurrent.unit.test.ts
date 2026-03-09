import assert from 'node:assert/strict';
import { countTrulyActiveWorkerJobs } from '../src/lib/server/worker-job-concurrency.js';

let failed = 0;

type SyncOrAsyncTest = () => void | Promise<void>;

type JobRow = {
  id: string;
  owner_id: string;
  status: string;
  claimed_by: string | null;
  locked_until: string | null;
};

type Filter =
  | { type: 'eq'; column: string; value: unknown }
  | { type: 'in'; column: string; values: unknown[] }
  | { type: 'not'; column: string; operator: string; value: unknown }
  | { type: 'gt'; column: string; value: string };

async function run(name: string, fn: SyncOrAsyncTest) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error: any) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error?.stack || error);
  }
}

function applyFilters(rows: JobRow[], filters: Filter[]): JobRow[] {
  return rows.filter((row) => {
    for (const filter of filters) {
      if (filter.type === 'eq') {
        if ((row as any)[filter.column] !== filter.value) return false;
      } else if (filter.type === 'in') {
        if (!filter.values.includes((row as any)[filter.column])) return false;
      } else if (filter.type === 'not') {
        if (filter.operator !== 'is') {
          throw new Error(`Unsupported not() operator: ${filter.operator}`);
        }
        if (filter.value !== null) {
          throw new Error('Test stub only supports not(column, \"is\", null).');
        }
        const value = (row as any)[filter.column];
        if (value === null || typeof value === 'undefined') return false;
      } else if (filter.type === 'gt') {
        const raw = (row as any)[filter.column];
        if (!raw) return false;
        if (new Date(raw).getTime() <= new Date(filter.value).getTime()) return false;
      }
    }
    return true;
  });
}

function createSupabaseStub(rows: JobRow[]) {
  const filters: Filter[] = [];

  const builder: any = {
    select(_columns: string, _opts?: any) {
      return builder;
    },
    eq(column: string, value: unknown) {
      filters.push({ type: 'eq', column, value });
      return builder;
    },
    in(column: string, values: unknown[]) {
      filters.push({ type: 'in', column, values });
      return builder;
    },
    not(column: string, operator: string, value: unknown) {
      filters.push({ type: 'not', column, operator, value });
      return builder;
    },
    gt(column: string, value: string) {
      filters.push({ type: 'gt', column, value });
      return builder;
    },
    then(resolve: any, reject: any) {
      try {
        const count = applyFilters(rows, filters).length;
        resolve({ count, data: null, error: null });
      } catch (err) {
        reject(err);
      }
    },
  };

  return {
    from(table: string) {
      assert.equal(table, 'au_worker_jobs');
      return builder;
    },
  };
}

async function main() {
  await run('failed jobs with claimed_by do not count toward concurrency', async () => {
    const nowIso = '2026-03-09T00:00:00.000Z';
    const supabase = createSupabaseStub([
      {
        id: 'job-1',
        owner_id: 'user-1',
        status: 'failed',
        claimed_by: 'worker-1',
        locked_until: '2026-03-10T00:00:00.000Z',
      },
      {
        id: 'job-2',
        owner_id: 'user-1',
        status: 'processing',
        claimed_by: 'worker-2',
        locked_until: '2026-03-08T23:59:00.000Z', // expired lease
      },
    ]);

    const result = await countTrulyActiveWorkerJobs({
      supabase: supabase as any,
      ownerId: 'user-1',
      nowIso,
    });

    assert.equal(result.error, null);
    assert.equal(result.count, 0);
  });

  await run('active leased processing jobs count toward concurrency', async () => {
    const nowIso = '2026-03-09T00:00:00.000Z';
    const supabase = createSupabaseStub([
      {
        id: 'job-1',
        owner_id: 'user-1',
        status: 'processing',
        claimed_by: 'worker-1',
        locked_until: '2026-03-09T00:10:00.000Z',
      },
      {
        id: 'job-2',
        owner_id: 'user-1',
        status: 'processing',
        claimed_by: null,
        locked_until: '2026-03-09T00:10:00.000Z',
      },
      {
        id: 'job-3',
        owner_id: 'user-2',
        status: 'processing',
        claimed_by: 'worker-2',
        locked_until: '2026-03-09T00:10:00.000Z',
      },
    ]);

    const result = await countTrulyActiveWorkerJobs({
      supabase: supabase as any,
      ownerId: 'user-1',
      nowIso,
    });

    assert.equal(result.error, null);
    assert.equal(result.count, 1);
  });

  if (failed > 0) {
    process.exit(1);
  }
}

void main();
