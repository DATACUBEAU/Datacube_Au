import assert from 'node:assert/strict';
import { safeSelectDocuments } from '../src/lib/server/document-usage-query.js';

let failed = 0;

type SyncOrAsyncTest = () => void | Promise<void>;

type QueryCall = {
  columns: string;
  filterType: 'or' | 'eq';
  filterValue: string;
};

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

function createSupabaseStub(
  responses: Array<{ data: any[] | null; error: any | null }>,
  calls: QueryCall[],
) {
  return {
    from(table: string) {
      assert.equal(table, 'au_documents');
      return {
        select(columns: string) {
          return {
            or(filterValue: string) {
              calls.push({ columns, filterType: 'or', filterValue });
              const next = responses.shift();
              if (!next) {
                throw new Error('Unexpected query without stubbed response.');
              }
              return Promise.resolve(next);
            },
            eq(column: string, value: string) {
              calls.push({ columns, filterType: 'eq', filterValue: `${column}:${value}` });
              const next = responses.shift();
              if (!next) {
                throw new Error('Unexpected query without stubbed response.');
              }
              return Promise.resolve(next);
            },
          };
        },
      };
    },
  };
}

async function main() {
  await run('safeSelectDocuments falls back to a column-safe query when file_size_bytes is missing', async () => {
    const calls: QueryCall[] = [];
    const supabase = createSupabaseStub(
      [
        {
          data: null,
          error: {
            code: '42703',
            message: 'column "file_size_bytes" does not exist',
          },
        },
        {
          data: [{ id: 'doc-1', created_at: '2026-03-07T12:00:00.000Z', status: 'ready' }],
          error: null,
        },
      ],
      calls,
    );

    const rows = await safeSelectDocuments(supabase as any, 'user-1');

    assert.deepEqual(rows, [
      {
        id: 'doc-1',
        created_at: '2026-03-07T12:00:00.000Z',
        file_size_bytes: null,
        status: 'ready',
      },
    ]);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].columns, 'id,file_size_bytes,created_at,status');
    assert.equal(calls[1].columns, 'id,created_at,status');
    assert.equal(calls[0].filterType, 'or');
    assert.equal(calls[1].filterType, 'or');
  });

  await run('safeSelectDocuments falls back from owner_id/user_id filters to user_id-only queries on schema drift', async () => {
    const calls: QueryCall[] = [];
    const supabase = createSupabaseStub(
      [
        {
          data: null,
          error: {
            code: '42703',
            message: 'column "owner_id" does not exist',
          },
        },
        {
          data: null,
          error: {
            code: '42703',
            message: 'column "owner_id" does not exist',
          },
        },
        {
          data: [
            {
              id: 'doc-2',
              created_at: '2026-03-07T13:00:00.000Z',
              file_size_bytes: 2048,
              status: 'processing',
            },
          ],
          error: null,
        },
      ],
      calls,
    );

    const rows = await safeSelectDocuments(supabase as any, 'user-2');

    assert.deepEqual(rows, [
      {
        id: 'doc-2',
        created_at: '2026-03-07T13:00:00.000Z',
        file_size_bytes: 2048,
        status: 'processing',
      },
    ]);
    assert.equal(calls.length, 3);
    assert.equal(calls[2].columns, 'id,file_size_bytes,created_at,status');
    assert.equal(calls[2].filterType, 'eq');
    assert.equal(calls[2].filterValue, 'user_id:user-2');
  });

  if (failed > 0) {
    process.exit(1);
  }
}

void main();