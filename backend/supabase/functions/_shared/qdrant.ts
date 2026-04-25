export interface QdrantSearchOptions {
  limit?: number;
  score_threshold?: number;
  filter?: any;
}

export interface QdrantSearchResult {
  id: string;
  score: number;
  payload: {
    document_id: string;
    text: string;
    user_id?: string;
    chunk_index: number;
    [key: string]: any;
  };
}

const QDRANT_URL = Deno.env.get("QDRANT_URL") || "";
const QDRANT_API_KEY = Deno.env.get("QDRANT_API_KEY") || "";
const COLLECTION_NAME = "au_chunks";

export async function searchQdrant(
  vector: number[],
  options: QdrantSearchOptions = {},
  collectionName: string = COLLECTION_NAME
): Promise<QdrantSearchResult[]> {
  if (!QDRANT_URL) {
    throw new Error("QDRANT_URL is not configured");
  }

  const { limit = 10, score_threshold = 0.5, filter } = options;

  const response = await fetch(`${QDRANT_URL}/collections/${collectionName}/points/search`, {
    method: "POST",
    headers: {
      "api-key": QDRANT_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      vector,
      limit,
      score_threshold,
      filter,
      with_payload: true,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    // Graceful handling for missing collection
    if (response.status === 404 || errorText.includes("doesn't exist")) {
        console.warn(`[Qdrant] Collection ${collectionName} not found. Returning empty results.`);
        return [];
    }
    throw new Error(`Qdrant search failed: ${errorText}`);
  }

  const data = await response.json();
  return data.result || [];
}

/**
 * Ensure collection exists
 */
export async function ensureCollection(collectionName: string = COLLECTION_NAME): Promise<void> {
    if (!QDRANT_URL) return;
    
    // Check if exists
    const check = await fetch(`${QDRANT_URL}/collections/${collectionName}`, {
        headers: { "api-key": QDRANT_API_KEY }
    });
    
    if (check.ok) return;
    
    // Create if not
    console.log(`[Qdrant] Creating collection ${collectionName}...`);
    const create = await fetch(`${QDRANT_URL}/collections/${collectionName}`, {
        method: 'PUT',
        headers: { 
            "api-key": QDRANT_API_KEY,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            vectors: {
                size: 384, // MiniLM-L6-v2
                distance: "Cosine"
            }
        })
    });
    
    if (!create.ok) {
        throw new Error(`Failed to create collection: ${await create.text()}`);
    }
}

/**
 * Delete points based on filter (e.g. retention policy)
 */
export async function deletePoints(filter: any, collectionName: string = COLLECTION_NAME): Promise<any> {
  if (!QDRANT_URL) {
    throw new Error("QDRANT_URL is not configured");
  }

  const response = await fetch(`${QDRANT_URL}/collections/${collectionName}/points/delete`, {
    method: "POST",
    headers: {
      "api-key": QDRANT_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      filter
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Qdrant delete failed: ${errorText}`);
  }

  return await response.json();
}

/**
 * Upsert points to Qdrant
 */
export async function upsertPoints(points: any[], collectionName: string = COLLECTION_NAME): Promise<any> {
  if (!QDRANT_URL) {
    throw new Error("QDRANT_URL is not configured");
  }

  const response = await fetch(`${QDRANT_URL}/collections/${collectionName}/points`, {
    method: "PUT",
    headers: {
      "api-key": QDRANT_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      points,
      wait: true
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    // Don't throw if collection missing, maybe handle upstream? 
    // But for now let's throw.
    throw new Error(`Qdrant upsert failed: ${errorText}`);
  }

  return await response.json();
}
