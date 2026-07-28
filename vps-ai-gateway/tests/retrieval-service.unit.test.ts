import assert from 'node:assert/strict';
import { RetrievalService } from '../src/retrieval-service.js';

let failed = 0;

type AsyncTest = () => void | Promise<void>;

async function run(name: string, fn: AsyncTest) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error: any) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error?.stack || error);
  }
}

async function main() {
  const service = new RetrievalService('http://localhost:6333', 'key', {} as any);
  
  let interceptedSearch: any = null;
  let interceptedScroll: any = null;
  
  (service as any).qdrant = {
    search: async (...args: any[]) => {
      interceptedSearch = args;
      return [];
    },
    scroll: async (...args: any[]) => {
      interceptedScroll = args;
      return { points: [] };
    }
  };

  // Mock embedQuery
  service.embedQuery = async () => [0.1, 0.2, 0.3];
  
  // Mock supabase fallback to avoid actually hitting the network
  (service as any).fallbackSupabaseRetrieval = async () => {
    return [];
  };

  await run('semanticTopKRetrieval: User/document access is validated and applies tenant filters', async () => {
    interceptedSearch = null;
    await service.semanticTopKRetrieval({ userId: 'userA', documentId: 'docA', query: 'hello' });
    
    assert.ok(interceptedSearch, 'search should have been called');
    const filter = interceptedSearch[1].filter.must;
    assert.ok(filter.some((f: any) => f.key === 'user_id' && f.match.value === 'userA'), 'Missing user_id filter');
    assert.ok(filter.some((f: any) => f.key === 'document_id' && f.match.value === 'docA'), 'Missing document_id filter');
  });

  await run('boundedCoverageRetrieval: Cross-user retrieval is denied', async () => {
    interceptedScroll = null;
    interceptedSearch = null;
    await service.boundedCoverageRetrieval({ userId: 'userB', documentId: 'docA' }); 
    
    assert.ok(interceptedScroll, 'scroll should have been called');
    const filter = interceptedScroll[1].filter.must;
    assert.ok(filter.some((f: any) => f.key === 'user_id' && f.match.value === 'userB'), 'User B filter not strictly applied');
    assert.ok(filter.some((f: any) => f.key === 'document_id' && f.match.value === 'docA'), 'Document filter not strictly applied');
  });

  await run('boundedCoverageRetrieval: Uses synthesized intent queries correctly', async () => {
    interceptedScroll = null;
    interceptedSearch = null;
    await service.boundedCoverageRetrieval({ userId: 'userC', documentId: 'docB', intentQueries: ['q1', 'q2'] });
    
    assert.ok(interceptedScroll, 'scroll should have been called for representative coverage');
    assert.ok(interceptedSearch, 'search should have been called for intents');
  });

  await run('Missing tenant/user filter fails closed', async () => {
    interceptedSearch = null;
    interceptedScroll = null;
    
    const resultsTopK = await service.semanticTopKRetrieval({ userId: '', documentId: 'docA', query: 'hello' });
    assert.equal(resultsTopK.length, 0, 'Should return empty array when userId is missing');
    assert.equal(interceptedSearch, null, 'Should not query Qdrant if user filter is missing');
    
    const resultsBounded = await service.boundedCoverageRetrieval({ userId: '', documentId: 'docA' });
    assert.equal(resultsBounded.length, 0, 'Should return empty array when userId is missing');
    assert.equal(interceptedScroll, null, 'Should not scroll Qdrant if user filter is missing');
  });

  await run('Missing document filter fails closed', async () => {
    interceptedSearch = null;
    interceptedScroll = null;
    
    const resultsTopK = await service.semanticTopKRetrieval({ userId: 'userA', query: 'hello' });
    assert.equal(resultsTopK.length, 0, 'Should return empty array when documentId is missing');
    assert.equal(interceptedSearch, null, 'Should not query Qdrant if document filter is missing');
    
    const resultsBounded = await service.boundedCoverageRetrieval({ userId: 'userA' });
    assert.equal(resultsBounded.length, 0, 'Should return empty array when documentId is missing');
    assert.equal(interceptedScroll, null, 'Should not scroll Qdrant if document filter is missing');
  });

  await run('Qdrant payload mismatches are discarded after filtered search', async () => {
    (service as any).qdrant.search = async (...args: any[]) => {
      interceptedSearch = args;
      return [
        {
          id: 'wrong-user',
          score: 0.9,
          payload: {
            user_id: 'userB',
            document_id: 'docA',
            chunk_index: 0,
            text: 'wrong user text',
          },
        },
        {
          id: 'right-user',
          score: 0.8,
          payload: {
            user_id: 'userA',
            document_id: 'docA',
            chunk_index: 1,
            text: 'right user text',
          },
        },
        {
          id: 'wrong-doc',
          score: 0.7,
          payload: {
            user_id: 'userA',
            document_id: 'docB',
            chunk_index: 2,
            text: 'wrong document text',
          },
        },
      ];
    };

    const results = await service.semanticTopKRetrieval({ userId: 'userA', documentId: 'docA', query: 'hello' });
    assert.equal(results.length, 1);
    assert.equal(results[0]?.text, 'right user text');
  });

  if (failed > 0) {
    process.exit(1);
  }
}

void main();
