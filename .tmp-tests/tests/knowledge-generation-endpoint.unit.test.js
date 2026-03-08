"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const document_usage_query_js_1 = require("../src/lib/server/document-usage-query.js");
let failed = 0;
async function run(name, fn) {
    try {
        await fn();
        console.log(`PASS ${name}`);
    }
    catch (error) {
        failed += 1;
        console.error(`FAIL ${name}`);
        console.error(error?.stack || error);
    }
}
function createSupabaseStub(responses, calls) {
    return {
        from(table) {
            strict_1.default.equal(table, 'au_documents');
            return {
                select(columns) {
                    return {
                        or(filterValue) {
                            calls.push({ columns, filterType: 'or', filterValue });
                            const next = responses.shift();
                            if (!next) {
                                throw new Error('Unexpected query without stubbed response.');
                            }
                            return Promise.resolve(next);
                        },
                        eq(column, value) {
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
        const calls = [];
        const supabase = createSupabaseStub([
            {
                data: null,
                error: {
                    code: '42703',
                    message: 'column "file_size_bytes" does not exist',
                },
            },
            {
                data: [{ id: 'doc-1', created_at: '2026-03-07T12:00:00.000Z' }],
                error: null,
            },
        ], calls);
        const rows = await (0, document_usage_query_js_1.safeSelectDocuments)(supabase, 'user-1');
        strict_1.default.deepEqual(rows, [
            {
                id: 'doc-1',
                created_at: '2026-03-07T12:00:00.000Z',
                file_size_bytes: null,
            },
        ]);
        strict_1.default.equal(calls.length, 2);
        strict_1.default.equal(calls[0].columns, 'id,file_size_bytes,created_at');
        strict_1.default.equal(calls[1].columns, 'id,created_at');
        strict_1.default.equal(calls[0].filterType, 'or');
        strict_1.default.equal(calls[1].filterType, 'or');
    });
    await run('safeSelectDocuments falls back from owner_id/user_id filters to user_id-only queries on schema drift', async () => {
        const calls = [];
        const supabase = createSupabaseStub([
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
                    },
                ],
                error: null,
            },
        ], calls);
        const rows = await (0, document_usage_query_js_1.safeSelectDocuments)(supabase, 'user-2');
        strict_1.default.deepEqual(rows, [
            {
                id: 'doc-2',
                created_at: '2026-03-07T13:00:00.000Z',
                file_size_bytes: 2048,
            },
        ]);
        strict_1.default.equal(calls.length, 3);
        strict_1.default.equal(calls[2].filterType, 'eq');
        strict_1.default.equal(calls[2].filterValue, 'user_id:user-2');
    });
    if (failed > 0) {
        process.exit(1);
    }
}
void main();
