import { resolveUploadMimeType } from './file-types';

type TusCreateArgs = {
  supabaseUrl: string;
  anonKey: string;
  accessToken: string;
  bucket: string;
  objectName: string;
  file: File;
  upsert?: boolean;
};

type TusUploadArgs = {
  uploadUrl: string;
  anonKey: string;
  accessToken: string;
  file: File;
  chunkSizeBytes?: number;
  signal?: AbortSignal;
  // Can be async. If async, uploadTus will await it to avoid progress write races (e.g. 100 -> 99).
  onProgress?: (uploadedBytes: number, totalBytes: number) => void | Promise<void>;
};

function b64(value: string): string {
  return btoa(unescape(encodeURIComponent(value)));
}

export async function createTusUpload({
  supabaseUrl,
  anonKey,
  accessToken,
  bucket,
  objectName,
  file,
  upsert = false,
}: TusCreateArgs): Promise<string> {
  const endpoint = `${supabaseUrl.replace(/\/$/, '')}/storage/v1/upload/resumable`;
  const mimeType = resolveUploadMimeType(file);
  const metadata = [
    `bucketName ${b64(bucket)}`,
    `objectName ${b64(objectName)}`,
    `contentType ${b64(mimeType)}`,
    `cacheControl ${b64('3600')}`,
    `filename ${b64(file.name)}`,
  ].join(',');

  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
      'Tus-Resumable': '1.0.0',
      'Upload-Length': String(file.size),
      'Upload-Metadata': metadata,
      'Content-Type': 'application/octet-stream',
      'x-upsert': upsert ? 'true' : 'false',
    },
  });

  if (!resp.ok) {
    throw new Error(`Failed to create resumable upload (${resp.status})`);
  }

  const location = resp.headers.get('location');
  if (!location) {
    throw new Error('Missing upload location.');
  }

  if (location.startsWith('http')) return location;
  return `${supabaseUrl.replace(/\/$/, '')}${location}`;
}

export async function getTusOffset(uploadUrl: string, anonKey: string, accessToken: string): Promise<number> {
  const resp = await fetch(uploadUrl, {
    method: 'HEAD',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
      'Tus-Resumable': '1.0.0',
    },
  });
  if (!resp.ok) {
    return 0;
  }
  const offset = resp.headers.get('upload-offset');
  return offset ? Number(offset) : 0;
}

export async function uploadTus({
  uploadUrl,
  anonKey,
  accessToken,
  file,
  chunkSizeBytes = 6 * 1024 * 1024,
  signal,
  onProgress,
}: TusUploadArgs): Promise<void> {
  let offset = await getTusOffset(uploadUrl, anonKey, accessToken);
  let stuckCount = 0;
  const MAX_STUCK_RETRIES = 3;

  while (offset < file.size) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const chunk = file.slice(offset, Math.min(file.size, offset + chunkSizeBytes));
    const chunkArrayBuffer = await chunk.arrayBuffer();

    console.log(`[TUS] Uploading chunk: offset ${offset}, size ${chunk.size}, total ${file.size}...`);

    const resp = await fetch(uploadUrl, {
      method: 'PATCH',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
        'Tus-Resumable': '1.0.0',
        'Upload-Offset': String(offset),
        'Content-Type': 'application/offset+octet-stream',
      },
      body: chunkArrayBuffer,
      signal,
    });

    if (!resp.ok) {
      const errorText = await resp.text().catch(() => 'No error body');
      console.error(`[TUS] Upload failed with status ${resp.status}:`, errorText);
      throw new Error(`Upload failed (${resp.status}): ${errorText}`);
    }

    const nextOffsetRaw = resp.headers.get('upload-offset');
    const nextOffset = nextOffsetRaw ? Number(nextOffsetRaw) : offset + chunk.size;
    
    if (nextOffset === offset) {
      stuckCount++;
      console.warn(`[TUS] Server returned same offset (${offset}). Retry ${stuckCount}/${MAX_STUCK_RETRIES}...`);
      if (stuckCount >= MAX_STUCK_RETRIES) {
        throw new Error("Upload stuck: server repeatedly returned same offset.");
      }
      // Wait a bit before retrying the same chunk
      await new Promise(resolve => setTimeout(resolve, 1000 * stuckCount));
      continue; 
    }

    stuckCount = 0; // Reset on success
    offset = nextOffset;
    // IMPORTANT: await to avoid late async progress writes overwriting the final 100% update.
    await onProgress?.(offset, file.size);
  }
}
