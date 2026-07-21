
import { SupabaseClient } from '@supabase/supabase-js';
import { logger, computeHash } from './utils';
import { FlagEmbedding, EmbeddingModel } from 'fastembed';
import { QdrantClient } from '@qdrant/js-client-rest';
import { createHash } from 'crypto';
import fs from 'fs';
import { promises as fsp } from 'fs';
import path from 'path';
import https from 'https';
import zlib from 'zlib';
import { Writable } from 'stream';
import { pipeline } from 'stream/promises';

type ChunkRow = {
  id: string;
  document_id: string;
  owner_id?: string;
  user_id?: string;
  chunk_index: number;
  text: string;
};

type CanonicalChunkRecord = {
  id: string;
  index: number;
  text: string;
  hash: string;
};

class RecoverableModelCacheError extends Error {
  recoverable = true;

  constructor(message: string) {
    super(message);
    this.name = 'RecoverableModelCacheError';
  }
}

type StandardEmbeddingModel = Exclude<EmbeddingModel, EmbeddingModel.CUSTOM>;
type EmbedderBackend =
  | { kind: 'fastembed'; model: FlagEmbedding }
  | { kind: 'transformers'; extractor: (texts: string[]) => Promise<number[][]> };

type DownloadInfo = {
  downloadedSizeBytes: number;
  contentType: string;
  previewText: string;
  hasGzipMagic: boolean;
  finalUrl: string;
};

class ModelDownloadBlockedError extends Error {
  blockedByRegion = true;

  constructor(
    message: string,
    readonly diagnostics: {
      modelUrl: string;
      finalUrl?: string;
      contentType?: string;
      downloadedSizeBytes?: number;
      previewText?: string;
      hasGzipMagic?: boolean;
    },
  ) {
    super(message);
    this.name = 'ModelDownloadBlockedError';
  }
}

export class IngestionService {
  private embedderBackend?: EmbedderBackend;
  private qdrant: QdrantClient;
  private pipelineId: string;
  private chunkInsertBatchSize: number;
  private embedBatchSize: number;
  private qdrantRetryCount: number;
  private startupMigrationRetryCount: number;
  private modelCacheDir: string;
  private modelLockTimeoutMs: number;
  private modelLockStaleMs: number;
  private transformersFallbackEnabled: boolean;
  private transformersModelId: string;
  private hfCacheDir: string;
  private preparedCollections: Set<string>;
  private startupIndexesEnsured = false;

  constructor(
    private supabase: SupabaseClient,
    qdrantUrl: string,
    qdrantApiKey?: string
  ) {
    this.qdrant = new QdrantClient({
      url: qdrantUrl,
      apiKey: qdrantApiKey,
      checkCompatibility: false,
    });
    this.pipelineId = process.env.WORKER_ID || process.env.PIPELINE_ID || 'vps-worker';
    this.chunkInsertBatchSize = this.parsePositiveInt(process.env.CHUNK_INSERT_BATCH_SIZE, 250);
    this.embedBatchSize = this.parsePositiveInt(process.env.EMBED_BATCH_SIZE, 96);
    this.qdrantRetryCount = this.parsePositiveInt(process.env.QDRANT_RETRY_COUNT, 3);
    this.startupMigrationRetryCount = this.parsePositiveInt(process.env.QDRANT_STARTUP_MIGRATION_RETRIES, 5);
    const configuredCacheDir = (process.env.FASTEMBED_CACHE_DIR || '/root/rag-worker/local_cache').trim();
    this.modelCacheDir = path.resolve(configuredCacheDir);
    this.modelLockTimeoutMs = this.parsePositiveInt(process.env.FASTEMBED_MODEL_LOCK_TIMEOUT_MS, 120000);
    this.modelLockStaleMs = this.parsePositiveInt(process.env.FASTEMBED_MODEL_LOCK_STALE_MS, 600000);
    const fallbackRaw = String(process.env.TRANSFORMERS_FALLBACK_ENABLED ?? process.env.ENABLE_TRANSFORMERS_FALLBACK ?? 'true').toLowerCase();
    this.transformersFallbackEnabled = !(fallbackRaw === 'false' || fallbackRaw === '0' || fallbackRaw === 'no');
    this.transformersModelId = (process.env.TRANSFORMERS_EMBEDDING_MODEL || 'Xenova/all-MiniLM-L6-v2').trim();
    this.hfCacheDir = path.resolve((process.env.HF_CACHE_DIR || path.join(this.modelCacheDir, 'hf-cache')).trim());
    this.preparedCollections = new Set<string>();
    this.assertTransformersDependencyReady();
  }

  private assertTransformersDependencyReady(): void {
    if (!this.transformersFallbackEnabled) return;
    try {
      require.resolve('@huggingface/transformers');
    } catch (error) {
      throw new Error(
        `TRANSFORMERS_FALLBACK_ENABLED=true but @huggingface/transformers is missing. Install worker dependencies with npm ci and rebuild the image. Details: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private parsePositiveInt(raw: string | undefined, fallback: number): number {
    const parsed = Number(raw ?? '');
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private isMissingTableError(error: any): boolean {
    const code = String(error?.code || '');
    const message = String(error?.message || '').toLowerCase();
    return (
      code === 'PGRST205' ||
      (message.includes('could not find the table') && message.includes('au_document_chunks'))
    );
  }

  private isMissingColumnError(error: any, column: string): boolean {
    const message = String(error?.message || '').toLowerCase();
    const details = String(error?.details || '').toLowerCase();
    const target = column.toLowerCase();
    return (
      message.includes(target) && message.includes('does not exist')
    ) || (
      details.includes(target) && details.includes('does not exist')
    );
  }

  private isRetryableQdrantError(error: any): boolean {
    const status = Number(error?.status || error?.statusCode || 0);
    if ([408, 409, 429, 500, 502, 503, 504].includes(status)) return true;

    const message = String(error?.message || '').toLowerCase();
    return (
      message.includes('timeout') ||
      message.includes('timed out') ||
      message.includes('network') ||
      message.includes('temporarily unavailable') ||
      message.includes('connection reset') ||
      message.includes('econnreset') ||
      message.includes('etimedout') ||
      message.includes('socket hang up')
    );
  }

  private async withQdrantRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= this.qdrantRetryCount; attempt += 1) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (attempt >= this.qdrantRetryCount || !this.isRetryableQdrantError(error)) {
          throw error;
        }
        const backoffMs = Math.min(400 * (2 ** (attempt - 1)), 3000);
        logger.warn(`${label} failed, retrying`, {
          attempt,
          backoffMs,
          message: error instanceof Error ? error.message : String(error),
        });
        await this.wait(backoffMs);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(`${label} failed`);
  }

  private modelToArchiveModel(model: StandardEmbeddingModel): string {
    if (model === EmbeddingModel.AllMiniLML6V2) {
      return `sentence-transformers${model.substring(model.indexOf('-'))}`;
    }
    return model;
  }

  private modelArchiveUrl(model: StandardEmbeddingModel): string {
    return `https://storage.googleapis.com/qdrant-fastembed/${this.modelToArchiveModel(model)}.tar.gz`;
  }

  private modelArchivePath(model: StandardEmbeddingModel): string {
    return path.join(this.modelCacheDir, `${model}.tar.gz`);
  }

  private modelDirPath(model: StandardEmbeddingModel): string {
    return path.join(this.modelCacheDir, model);
  }

  private isModelCacheCorruptionError(error: unknown): boolean {
    const code = String((error as any)?.code || '').toUpperCase();
    const message = String((error as any)?.message || '').toLowerCase();
    return (
      code.includes('TAR_BAD_ARCHIVE') ||
      message.includes('tar_bad_archive') ||
      message.includes('invalid gzip') ||
      message.includes('gzip validation') ||
      message.includes('unexpected end of file') ||
      message.includes('required files are missing') ||
      message.includes('incorrect header check')
    );
  }

  private async isValidGzip(filePath: string): Promise<boolean> {
    if (!fs.existsSync(filePath)) return false;
    try {
      await pipeline(
        fs.createReadStream(filePath),
        zlib.createGunzip(),
        new Writable({
          write(_chunk, _encoding, callback) {
            callback();
          },
        }),
      );
      return true;
    } catch {
      return false;
    }
  }

  private async ensureModelFilesExist(modelDir: string): Promise<boolean> {
    const required = [
      'onnx/model.onnx',
      'tokenizer.json',
      'tokenizer_config.json',
      'config.json',
      'special_tokens_map.json',
    ];

    try {
      for (const rel of required) {
        await fsp.access(path.join(modelDir, rel));
      }
      return true;
    } catch {
      return false;
    }
  }

  private hasGzipMagicBytes(buffer: Buffer): boolean {
    return buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
  }

  private toPreviewText(raw: string): string {
    return raw.replace(/\s+/g, ' ').trim().slice(0, 500);
  }

  private isBlockedTextPayload(contentType: string, previewText: string): boolean {
    const ct = String(contentType || '').toLowerCase();
    const preview = String(previewText || '').toLowerCase();
    const looksText = ct.includes('xml') || ct.includes('html') || ct.includes('text') || preview.startsWith('<');
    if (!looksText) return false;
    return (
      preview.includes('accessdenied') ||
      preview.includes('access denied') ||
      preview.includes('service is not available in your location') ||
      preview.includes('service unavailable in your location') ||
      preview.includes('<error') ||
      preview.includes('<html')
    );
  }

  private async downloadToTempFile(url: string, tempPath: string): Promise<DownloadInfo> {
    const headers = { 'User-Agent': 'DatacubeAU-RAGWorker/1.0' };

    return new Promise((resolve, reject) => {
      const request = https.get(url, { headers }, (response) => {
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          response.resume();
          void this.downloadToTempFile(response.headers.location, tempPath).then(resolve).catch(reject);
          return;
        }

        if (!response.statusCode || response.statusCode >= 400) {
          const status = response.statusCode || 0;
          const contentType = String(response.headers['content-type'] || '');
          const chunks: Buffer[] = [];
          let total = 0;
          const maxPreview = 4096;

          response.on('data', (chunk: Buffer) => {
            if (total >= maxPreview) return;
            const needed = maxPreview - total;
            const slice = chunk.subarray(0, needed);
            chunks.push(Buffer.from(slice));
            total += slice.length;
          });

          response.on('end', () => {
            const previewText = Buffer.concat(chunks).toString('utf8');
            const preview = this.toPreviewText(previewText);
            const blocked = this.isBlockedTextPayload(contentType, previewText) || [401, 403, 451].includes(status);
            if (blocked) {
              reject(
                new ModelDownloadBlockedError(
                  'model download blocked by region; using fallback embedder',
                  {
                    modelUrl: url,
                    finalUrl: url,
                    contentType,
                    downloadedSizeBytes: 0,
                    previewText: preview,
                    hasGzipMagic: false,
                  },
                ),
              );
              return;
            }
            reject(new Error(`Failed to download model archive. status=${status}`));
          });

          response.on('error', (error) => {
            reject(error);
          });
          return;
        }

        const out = fs.createWriteStream(tempPath);
        let bytes = 0;
        const previewChunks: Buffer[] = [];
        let previewLength = 0;
        const maxPreview = 4096;
        let firstBytes = Buffer.alloc(0);
        const contentType = String(response.headers['content-type'] || '');

        response.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (firstBytes.length < 8) {
            const needed = 8 - firstBytes.length;
            firstBytes = Buffer.concat([firstBytes, chunk.subarray(0, needed)]);
          }
          if (previewLength < maxPreview) {
            const needed = maxPreview - previewLength;
            const slice = chunk.subarray(0, needed);
            previewChunks.push(Buffer.from(slice));
            previewLength += slice.length;
          }
        });

        response.on('error', (error) => {
          out.destroy(error);
        });

        out.on('error', (error) => {
          reject(error);
        });

        out.on('finish', () => {
          out.close();
          const previewText = Buffer.concat(previewChunks).toString('utf8');
          resolve({
            downloadedSizeBytes: bytes,
            contentType,
            previewText,
            hasGzipMagic: this.hasGzipMagicBytes(firstBytes),
            finalUrl: url,
          });
        });

        response.pipe(out);
      });

      request.on('error', (error) => {
        reject(error);
      });
    });
  }

  private async cleanupModelCache(model: StandardEmbeddingModel): Promise<void> {
    await fsp.rm(this.modelArchivePath(model), { force: true }).catch(() => {});
    await fsp.rm(this.modelDirPath(model), { recursive: true, force: true }).catch(() => {});
  }

  private async acquireModelLock(lockPath: string) {
    const started = Date.now();

    while (true) {
      try {
        return await fsp.open(lockPath, 'wx');
      } catch (error: any) {
        if (error?.code !== 'EEXIST') {
          throw error;
        }

        try {
          const stat = await fsp.stat(lockPath);
          if (Date.now() - stat.mtimeMs > this.modelLockStaleMs) {
            await fsp.rm(lockPath, { force: true }).catch(() => {});
            continue;
          }
        } catch {
          // Ignore stat errors and keep waiting.
        }

        if (Date.now() - started > this.modelLockTimeoutMs) {
          throw new Error(`Timed out waiting for FastEmbed model lock: ${lockPath}`);
        }
        await this.wait(300);
      }
    }
  }

  private async withModelCacheLock<T>(fn: () => Promise<T>): Promise<T> {
    await fsp.mkdir(this.modelCacheDir, { recursive: true });
    const lockPath = path.join(this.modelCacheDir, '.fastembed-model.lock');
    const handle = await this.acquireModelLock(lockPath);
    try {
      return await fn();
    } finally {
      try {
        await handle.close();
      } catch {
        // ignore
      }
      await fsp.rm(lockPath, { force: true }).catch(() => {});
    }
  }

  private async ensureModelArchiveReady(model: StandardEmbeddingModel): Promise<void> {
    const archivePath = this.modelArchivePath(model);
    const url = this.modelArchiveUrl(model);

    if (fs.existsSync(archivePath)) {
      const valid = await this.isValidGzip(archivePath);
      const stat = valid ? await fsp.stat(archivePath).catch(() => null) : null;
      logger.info('FastEmbed model archive check', {
        modelUrl: url,
        cacheDir: this.modelCacheDir,
        archivePath,
        downloadedSizeBytes: stat?.size ?? null,
        gzipValid: valid,
      });
      if (valid) return;
      await fsp.rm(archivePath, { force: true }).catch(() => {});
    }

    const tempPath = `${archivePath}.tmp-${process.pid}-${Date.now()}`;
    let downloadInfo: DownloadInfo | null = null;
    try {
      downloadInfo = await this.downloadToTempFile(url, tempPath);
      const preview = this.toPreviewText(downloadInfo.previewText);
      const blockedTextPayload = this.isBlockedTextPayload(downloadInfo.contentType, downloadInfo.previewText);
      const nonGzipResponse = !downloadInfo.hasGzipMagic;

      logger.info('FastEmbed model archive downloaded', {
        modelUrl: url,
        finalUrl: downloadInfo.finalUrl,
        cacheDir: this.modelCacheDir,
        archivePath,
        downloadedSizeBytes: downloadInfo.downloadedSizeBytes,
        contentType: downloadInfo.contentType || null,
        hasGzipMagic: downloadInfo.hasGzipMagic,
        blockedTextPayload,
        previewText: preview,
      });

      if (blockedTextPayload || nonGzipResponse) {
        throw new ModelDownloadBlockedError(
          'model download blocked by region; using fallback embedder',
          {
            modelUrl: url,
            finalUrl: downloadInfo.finalUrl,
            contentType: downloadInfo.contentType,
            downloadedSizeBytes: downloadInfo.downloadedSizeBytes,
            previewText: preview,
            hasGzipMagic: downloadInfo.hasGzipMagic,
          },
        );
      }

      const gzipValid = await this.isValidGzip(tempPath);
      logger.info('FastEmbed model archive gzip validation', {
        modelUrl: url,
        finalUrl: downloadInfo.finalUrl,
        cacheDir: this.modelCacheDir,
        archivePath,
        downloadedSizeBytes: downloadInfo.downloadedSizeBytes,
        gzipValid,
      });
      if (!gzipValid) {
        throw new Error('Downloaded FastEmbed archive failed gzip validation');
      }
      await fsp.rename(tempPath, archivePath);
    } finally {
      await fsp.rm(tempPath, { force: true }).catch(() => {});
    }
  }

  private async extractModelArchive(model: StandardEmbeddingModel): Promise<void> {
    const tar = await import('tar');
    await tar.x({
      file: this.modelArchivePath(model),
      cwd: this.modelCacheDir,
    });
  }

  private async ensureModelCacheReady(model: StandardEmbeddingModel): Promise<void> {
    await this.withModelCacheLock(async () => {
      const modelDir = this.modelDirPath(model);
      const modelExists = await this.ensureModelFilesExist(modelDir);
      if (modelExists) {
        return;
      }

      await fsp.rm(modelDir, { recursive: true, force: true }).catch(() => {});
      await this.ensureModelArchiveReady(model);
      await this.extractModelArchive(model);

      const extractedOk = await this.ensureModelFilesExist(modelDir);
      if (!extractedOk) {
        throw new Error(`Model extraction finished but required files are missing: ${modelDir}`);
      }
    });
  }

  private async initModelWithCacheRetry(model: StandardEmbeddingModel): Promise<FlagEmbedding> {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        await this.ensureModelCacheReady(model);
        logger.info('Initializing FastEmbed model', {
          model,
          cacheDir: this.modelCacheDir,
          attempt,
        });
        return await FlagEmbedding.init({
          model,
          cacheDir: this.modelCacheDir,
          showDownloadProgress: false,
        });
      } catch (error) {
        const cacheCorruption = this.isModelCacheCorruptionError(error);
        if (!cacheCorruption || attempt >= 2) {
          if (cacheCorruption) {
            throw new RecoverableModelCacheError(
              `FastEmbed cache corruption persisted after cleanup+retry: ${error instanceof Error ? error.message : String(error)}`
            );
          }
          throw error;
        }

        logger.warn('FastEmbed cache corruption detected; cleaning cache and retrying', {
          model,
          cacheDir: this.modelCacheDir,
          attempt,
          message: error instanceof Error ? error.message : String(error),
        });
        await this.withModelCacheLock(async () => {
          await this.cleanupModelCache(model);
        });
      }
    }

    throw new Error('Failed to initialize FastEmbed model');
  }

  private l2Normalize(values: number[]): number[] {
    const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
    if (!Number.isFinite(norm) || norm <= 0) return values;
    return values.map((value) => value / norm);
  }

  private coerceTransformersOutput(output: any, expectedCount: number): number[][] {
    if (output && typeof output.tolist === 'function') {
      const listed = output.tolist();
      if (Array.isArray(listed) && Array.isArray(listed[0])) {
        return (listed as any[]).map((row) => (row as any[]).map((value) => Number(value)));
      }
    }

    if (Array.isArray(output) && Array.isArray(output[0])) {
      return (output as any[]).map((row) => (row as any[]).map((value) => Number(value)));
    }

    const dims: number[] = Array.isArray(output?.dims) ? output.dims.map((v: any) => Number(v)) : [];
    const dataSource = output?.data || output?.cpuData;
    const rawData = dataSource ? Array.from(dataSource as Iterable<number>, (v) => Number(v)) : [];

    if (dims.length === 2 && rawData.length === dims[0] * dims[1]) {
      const [rows, cols] = dims;
      const result: number[][] = [];
      for (let row = 0; row < rows; row += 1) {
        result.push(rawData.slice(row * cols, (row + 1) * cols));
      }
      return result;
    }

    if (dims.length === 3 && rawData.length === dims[0] * dims[1] * dims[2]) {
      const [rows, seq, cols] = dims;
      const result: number[][] = [];
      for (let row = 0; row < rows; row += 1) {
        const pooled = new Array(cols).fill(0);
        for (let token = 0; token < seq; token += 1) {
          const base = row * seq * cols + token * cols;
          for (let col = 0; col < cols; col += 1) {
            pooled[col] += rawData[base + col];
          }
        }
        const mean = pooled.map((value) => value / Math.max(seq, 1));
        result.push(this.l2Normalize(mean));
      }
      return result;
    }

    if (dims.length === 1 && expectedCount === 1 && rawData.length === dims[0]) {
      return [rawData];
    }

    throw new Error(`Unexpected transformers embedding output shape: dims=${JSON.stringify(dims)}`);
  }

  private async initTransformersExtractor(): Promise<(texts: string[]) => Promise<number[][]>> {
    const moduleName = '@huggingface/transformers';
    let transformers: any;
    try {
      transformers = await import(moduleName);
    } catch (error) {
      throw new Error(
        `model download blocked by region; fallback embedder disabled or unavailable. Install @huggingface/transformers and set TRANSFORMERS_FALLBACK_ENABLED=true. Details: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const envObj = transformers?.env;
    if (envObj) {
      envObj.cacheDir = this.hfCacheDir;
      envObj.allowLocalModels = true;
    }

    await fsp.mkdir(this.hfCacheDir, { recursive: true });

    logger.info('Initializing Transformers fallback embedder', {
      model: this.transformersModelId,
      cacheDir: this.hfCacheDir,
    });

    const pipelineFactory = transformers?.pipeline;
    if (typeof pipelineFactory !== 'function') {
      throw new Error('Transformers fallback pipeline() is unavailable');
    }

    const extractor = await pipelineFactory('feature-extraction', this.transformersModelId, {
      cache_dir: this.hfCacheDir,
    });

    return async (texts: string[]) => {
      if (!Array.isArray(texts) || texts.length === 0) return [];
      const output = await extractor(texts, { pooling: 'mean', normalize: true });
      const vectors = this.coerceTransformersOutput(output, texts.length);
      return vectors.map((vector) => this.l2Normalize(vector));
    };
  }

  private async getEmbedder(): Promise<EmbedderBackend> {
    if (this.embedderBackend) return this.embedderBackend;

    if (this.transformersFallbackEnabled) {
      logger.info('Transformers-only embedder mode enabled; FastEmbed initialization skipped', {
        model: this.transformersModelId,
        hfCacheDir: this.hfCacheDir,
      });
      const extractor = await this.initTransformersExtractor();
      this.embedderBackend = { kind: 'transformers', extractor };
      return this.embedderBackend;
    }

    try {
      const model = await this.initModelWithCacheRetry(EmbeddingModel.AllMiniLML6V2);
      this.embedderBackend = { kind: 'fastembed', model };
      return this.embedderBackend;
    } catch (error) {
      if (error instanceof ModelDownloadBlockedError) {
        logger.warn('model download blocked by region while transformers fallback is disabled', {
          modelUrl: error.diagnostics.modelUrl,
          finalUrl: error.diagnostics.finalUrl || null,
          contentType: error.diagnostics.contentType || null,
          downloadedSizeBytes: error.diagnostics.downloadedSizeBytes ?? null,
          previewText: error.diagnostics.previewText || null,
          hasGzipMagic: error.diagnostics.hasGzipMagic ?? null,
        });
        throw new Error(
          `model download blocked by region; TRANSFORMERS_FALLBACK_ENABLED is disabled. Enable TRANSFORMERS_FALLBACK_ENABLED=true to force Transformers embeddings.`,
        );
      }
      throw error;
    }
  }

  private ownerFilter(documentId: string, ownerId: string) {
    return {
      must: [
        { key: 'document_id', match: { value: documentId } },
      ],
      should: [
        { key: 'owner_id', match: { value: ownerId } },
        { key: 'user_id', match: { value: ownerId } },
      ],
    } as any;
  }

  private payloadIndexSpecs() {
    return [
      { field_name: 'text_hash', field_schemas: ['keyword'] as const },
      { field_name: 'created_at', field_schemas: ['integer'] as const },
      { field_name: 'expires_at', field_schemas: ['integer'] as const },
      { field_name: 'expiresAt', field_schemas: ['integer'] as const },
      { field_name: 'owner_id', field_schemas: ['uuid', 'keyword'] as const },
      { field_name: 'user_id', field_schemas: ['uuid', 'keyword'] as const },
      { field_name: 'document_id', field_schemas: ['uuid', 'keyword'] as const },
    ];
  }

  private isIndexAlreadyExistsError(error: any): boolean {
    const message = String(error?.message || '').toLowerCase();
    return (
      message.includes('already exists') ||
      message.includes('already indexed') ||
      message.includes('index exists') ||
      message.includes('duplicate')
    );
  }

  private isUnsupportedSchemaError(error: any): boolean {
    const status = Number(error?.status || error?.statusCode || 0);
    if (status !== 400) return false;
    const message = String(error?.message || '').toLowerCase();
    return (
      message.includes('invalid') ||
      message.includes('unknown') ||
      message.includes('wrong input') ||
      message.includes('field_schema')
    );
  }

  private async ensurePayloadIndex(
    collectionName: string,
    fieldName: string,
    candidateSchemas: readonly string[],
  ): Promise<void> {
    let lastError: unknown = null;
    for (const fieldSchema of candidateSchemas) {
      try {
        await this.withQdrantRetry(`Qdrant createPayloadIndex:${fieldName}:${fieldSchema}`, () =>
          this.qdrant.createPayloadIndex(collectionName, {
            field_name: fieldName,
            field_schema: fieldSchema as any,
          } as any)
        );

        logger.info('Qdrant payload index ensured', {
          collectionName,
          fieldName,
          fieldSchema,
        });
        return;
      } catch (error: any) {
        if (this.isIndexAlreadyExistsError(error)) {
          logger.info('Qdrant payload index already exists', {
            collectionName,
            fieldName,
            requestedSchema: fieldSchema,
          });
          return;
        }

        if (this.isUnsupportedSchemaError(error)) {
          lastError = error;
          continue;
        }

        throw error;
      }
    }

    if (lastError) {
      throw lastError;
    }
  }

  private async ensureCollectionIndexes(collectionName: string): Promise<void> {
    const specs = this.payloadIndexSpecs();
    for (const spec of specs) {
      await this.ensurePayloadIndex(collectionName, spec.field_name, spec.field_schemas);
    }
  }

  private async ensureCollection(collectionName: string): Promise<void> {
    let exists = false;
    try {
      await this.withQdrantRetry('Qdrant getCollection', () => this.qdrant.getCollection(collectionName));
      exists = true;
    } catch (error: any) {
      if (Number(error?.status) !== 404 && !String(error?.message || '').toLowerCase().includes('not found')) {
        throw error;
      }
    }

    if (!exists) {
      logger.info('Creating Qdrant collection', { collectionName });
      await this.withQdrantRetry('Qdrant createCollection', () => this.qdrant.createCollection(collectionName, {
        vectors: {
          size: 384,
          distance: 'Cosine',
        },
      }));
    }

    if (this.preparedCollections.has(collectionName)) {
      return;
    }

    await this.ensureCollectionIndexes(collectionName);
    this.preparedCollections.add(collectionName);
  }

  async ensureStartupIndexes(): Promise<void> {
    if (this.startupIndexesEnsured) return;

    const collectionName = 'au_chunks';
    for (let attempt = 1; attempt <= this.startupMigrationRetryCount; attempt += 1) {
      try {
        await this.ensureCollection(collectionName);
        this.startupIndexesEnsured = true;
        logger.info('Qdrant startup migration complete', {
          collectionName,
          attempts: attempt,
          ensuredIndexes: this.payloadIndexSpecs().map((spec) => spec.field_name),
        });
        return;
      } catch (error) {
        if (attempt >= this.startupMigrationRetryCount) {
          throw error;
        }

        const backoffMs = Math.min(1000 * (2 ** (attempt - 1)), 10000);
        logger.warn('Qdrant startup migration failed, retrying', {
          collectionName,
          attempt,
          backoffMs,
          message: error instanceof Error ? error.message : String(error),
        });
        await this.wait(backoffMs);
      }
    }
  }

  private async clearChunkRows(documentId: string, ownerId: string): Promise<void> {
    const strategies: Array<(query: any) => any> = [
      (query) => query.eq('owner_id', ownerId),
      (query) => query.eq('user_id', ownerId),
      (query) => query,
    ];

    let lastError: any = null;
    for (const apply of strategies) {
      const query = this.supabase
        .from('au_document_chunks')
        .delete()
        .eq('document_id', documentId);
      apply(query);
      const { error } = await query;
      if (!error) return;

      if (this.isMissingTableError(error)) {
        throw new Error(
          'Missing table public.au_document_chunks. Apply worker pipeline migrations before running ingestion.'
        );
      }
      if (
        this.isMissingColumnError(error, 'owner_id') ||
        this.isMissingColumnError(error, 'user_id')
      ) {
        lastError = error;
        continue;
      }
      throw error;
    }

    if (lastError) throw lastError;
  }

  private async insertChunkRows(rows: ChunkRow[]): Promise<void> {
    const variants: ChunkRow[][] = [
      rows,
      rows.map(({ owner_id, ...rest }) => ({ ...rest })),
      rows.map(({ user_id, ...rest }) => ({ ...rest })),
      rows.map(({ owner_id, user_id, ...rest }) => ({ ...rest })),
    ];

    let lastError: any = null;
    for (const variant of variants) {
      let variantError: any = null;
      for (let start = 0; start < variant.length; start += this.chunkInsertBatchSize) {
        const batch = variant.slice(start, start + this.chunkInsertBatchSize);
        const { error } = await this.supabase
          .from('au_document_chunks')
          .insert(batch as any[]);
        if (error) {
          variantError = error;
          break;
        }
      }

      if (!variantError) {
        return;
      }

      if (this.isMissingTableError(variantError)) {
        throw new Error(
          'Missing table public.au_document_chunks. Apply worker pipeline migrations before running ingestion.'
        );
      }

      if (
        this.isMissingColumnError(variantError, 'owner_id') ||
        this.isMissingColumnError(variantError, 'user_id')
      ) {
        lastError = variantError;
        continue;
      }

      throw variantError;
    }

    if (lastError) throw lastError;
  }

  private async countChunkRows(documentId: string, ownerId: string): Promise<number> {
    const strategies: Array<(query: any) => any> = [
      (query) => query.eq('owner_id', ownerId),
      (query) => query.eq('user_id', ownerId),
      (query) => query,
    ];

    let lastError: any = null;
    for (const apply of strategies) {
      const query = this.supabase
        .from('au_document_chunks')
        .select('id', { count: 'exact', head: true })
        .eq('document_id', documentId);
      apply(query);
      const { count, error } = await query;
      if (!error) return Number(count || 0);

      if (this.isMissingTableError(error)) {
        throw new Error(
          'Missing table public.au_document_chunks. Apply worker pipeline migrations before running ingestion.'
        );
      }
      if (
        this.isMissingColumnError(error, 'owner_id') ||
        this.isMissingColumnError(error, 'user_id')
      ) {
        lastError = error;
        continue;
      }
      throw error;
    }

    if (lastError) throw lastError;
    return 0;
  }

  private async embedTexts(embedder: EmbedderBackend, texts: string[]): Promise<number[][]> {
    if (embedder.kind === 'transformers') {
      return embedder.extractor(texts);
    }

    const embeddingResult: any = embedder.model.embed(texts);
    const embeddings: number[][] = [];

    if (embeddingResult && typeof embeddingResult[Symbol.asyncIterator] === 'function') {
      for await (const batch of embeddingResult) {
        embeddings.push(...(batch as number[][]));
      }
    } else {
      const resolved = await embeddingResult;
      embeddings.push(...(resolved as number[][]));
    }

    return embeddings;
  }

  private validateCanonicalChunkText(documentId: string, chunkIndex: number, value: unknown): string {
    if (typeof value !== 'string') {
      throw new Error(`invalid_chunk_text_non_string: document=${documentId} chunk_index=${chunkIndex}`);
    }

    const text = value;
    const trimmed = text.trim();
    if (!trimmed) {
      throw new Error(`invalid_chunk_text_empty: document=${documentId} chunk_index=${chunkIndex}`);
    }

    if (/^0+$/.test(trimmed)) {
      throw new Error(`invalid_chunk_text_zero_fill: document=${documentId} chunk_index=${chunkIndex}`);
    }

    return text;
  }

  private buildCanonicalChunkRecords(
    documentId: string,
    ownerId: string,
    chunks: string[],
  ): CanonicalChunkRecord[] {
    return chunks.map((rawText, index) => {
      const text = this.validateCanonicalChunkText(documentId, index, rawText);
      const hash = computeHash(text);

      logger.info('Canonical chunk prepared', {
        documentId,
        ownerId,
        chunkIndex: index,
        textLength: text.length,
        textHash: hash,
      });

      return {
        id: this.stablePointId(ownerId, documentId, index),
        index,
        text,
        hash,
      };
    });
  }

  private async fetchChunkRowsForVerification(documentId: string, ownerId: string): Promise<ChunkRow[]> {
    const strategies: Array<(query: any) => any> = [
      (query) => query.eq('owner_id', ownerId),
      (query) => query.eq('user_id', ownerId),
      (query) => query,
    ];

    let lastError: any = null;
    for (const apply of strategies) {
      const query = this.supabase
        .from('au_document_chunks')
        .select('id,document_id,chunk_index,text')
        .eq('document_id', documentId)
        .order('chunk_index', { ascending: true });
      apply(query);
      const { data, error } = await query;
      if (!error) {
        return (data || []) as ChunkRow[];
      }

      if (this.isMissingTableError(error)) {
        throw new Error(
          'Missing table public.au_document_chunks. Apply worker pipeline migrations before running ingestion.'
        );
      }
      if (
        this.isMissingColumnError(error, 'owner_id') ||
        this.isMissingColumnError(error, 'user_id')
      ) {
        lastError = error;
        continue;
      }
      throw error;
    }

    if (lastError) throw lastError;
    return [];
  }

  private verifyChunkRowInvariants(
    documentId: string,
    canonicalChunks: CanonicalChunkRecord[],
    rows: ChunkRow[],
  ): void {
    if (rows.length !== canonicalChunks.length) {
      throw new Error(
        `chunk_row_invariant_count_mismatch: document=${documentId} expected=${canonicalChunks.length} got=${rows.length}`
      );
    }

    for (let index = 0; index < canonicalChunks.length; index += 1) {
      const expected = canonicalChunks[index];
      const row = rows[index];
      const rowDocumentId = String((row as any)?.document_id || '').trim();
      const rowIndex = Number((row as any)?.chunk_index);
      const rowText = this.validateCanonicalChunkText(documentId, index, (row as any)?.text);
      const rowHash = computeHash(rowText);

      if (rowDocumentId !== documentId) {
        throw new Error(
          `chunk_row_invariant_document_mismatch: document=${documentId} chunk_index=${index} row_document=${rowDocumentId}`
        );
      }
      if (rowIndex !== expected.index) {
        throw new Error(
          `chunk_row_invariant_index_mismatch: document=${documentId} expected_index=${expected.index} row_index=${rowIndex}`
        );
      }
      if (rowText !== expected.text) {
        throw new Error(
          `chunk_row_invariant_text_mismatch: document=${documentId} chunk_index=${index}`
        );
      }
      if (rowHash !== expected.hash) {
        throw new Error(
          `chunk_row_invariant_hash_mismatch: document=${documentId} chunk_index=${index}`
        );
      }
    }
  }

  private async fetchQdrantPointsForDocument(
    collectionName: string,
    documentId: string,
    ownerId: string,
    expectedCount: number,
  ): Promise<any[]> {
    const allPoints: any[] = [];
    let offset: any = undefined;

    while (allPoints.length < expectedCount) {
      const result = await this.withQdrantRetry('Qdrant verification scroll', () =>
        this.qdrant.scroll(collectionName, {
          filter: this.ownerFilter(documentId, ownerId),
          limit: Math.min(256, Math.max(expectedCount - allPoints.length, 1)),
          with_payload: true,
          with_vector: false,
          offset,
        } as any)
      );

      const points = Array.isArray((result as any)?.points) ? (result as any).points : [];
      allPoints.push(...points);
      offset = (result as any)?.next_page_offset;

      if (!offset || points.length === 0) {
        break;
      }
    }

    return allPoints;
  }

  private verifyQdrantPayloadInvariants(
    documentId: string,
    canonicalChunks: CanonicalChunkRecord[],
    points: any[],
  ): void {
    if (points.length !== canonicalChunks.length) {
      throw new Error(
        `qdrant_payload_invariant_count_mismatch: document=${documentId} expected=${canonicalChunks.length} got=${points.length}`
      );
    }

    const byIndex = new Map<number, CanonicalChunkRecord>();
    for (const chunk of canonicalChunks) {
      byIndex.set(chunk.index, chunk);
    }

    const seen = new Set<number>();
    for (const point of points) {
      const payload = point?.payload || {};
      const payloadDocumentId = String(payload.document_id || '').trim();
      const payloadIndex = Number(payload.chunk_index);
      const payloadText = this.validateCanonicalChunkText(documentId, payloadIndex, payload.text);
      const payloadHash = String(payload.text_hash || computeHash(payloadText)).trim();
      const expected = byIndex.get(payloadIndex);

      if (!expected) {
        throw new Error(
          `qdrant_payload_invariant_unknown_chunk_index: document=${documentId} chunk_index=${payloadIndex}`
        );
      }
      if (payloadDocumentId !== documentId) {
        throw new Error(
          `qdrant_payload_invariant_document_mismatch: document=${documentId} payload_document=${payloadDocumentId} chunk_index=${payloadIndex}`
        );
      }
      if (payloadText !== expected.text) {
        throw new Error(
          `qdrant_payload_invariant_text_mismatch: document=${documentId} chunk_index=${payloadIndex}`
        );
      }
      if (payloadHash !== expected.hash) {
        throw new Error(
          `qdrant_payload_invariant_hash_mismatch: document=${documentId} chunk_index=${payloadIndex}`
        );
      }

      seen.add(payloadIndex);
    }

    for (const chunk of canonicalChunks) {
      if (!seen.has(chunk.index)) {
        throw new Error(
          `qdrant_payload_invariant_missing_chunk: document=${documentId} chunk_index=${chunk.index}`
        );
      }
    }
  }

  /**
   * Upserts chunks into Qdrant and verifies chunk/vector integrity.
   */
  async processDocument(
    documentId: string,
    chunks: string[],
    ownerId: string,
    expiresAt: number
  ): Promise<void> {
    if (!Array.isArray(chunks) || chunks.length === 0) {
      throw new Error('Cannot process empty chunk list');
    }

    const startedAt = Date.now();
    logger.info('Processing document', { documentId, ownerId, chunkCount: chunks.length, expiresAt });
    const collectionName = 'au_chunks';
    await this.ensureCollection(collectionName);

    const chunkData = this.buildCanonicalChunkRecords(documentId, ownerId, chunks);

    const createdAt = Math.floor(Date.now() / 1000);

    await this.clearChunkRows(documentId, ownerId);
    const chunkRows: ChunkRow[] = chunkData.map((chunk) => ({
      id: chunk.id,
      document_id: documentId,
      owner_id: ownerId,
      user_id: ownerId,
      chunk_index: chunk.index,
      text: chunk.text,
    }));
    await this.insertChunkRows(chunkRows);

    const dbChunkCount = await this.countChunkRows(documentId, ownerId);
    if (dbChunkCount !== chunkData.length) {
      throw new Error(`Chunk row mismatch: expected ${chunkData.length}, got ${dbChunkCount}`);
    }

    const persistedChunkRows = await this.fetchChunkRowsForVerification(documentId, ownerId);
    this.verifyChunkRowInvariants(documentId, chunkData, persistedChunkRows);

    try {
      await this.withQdrantRetry('Qdrant delete preflight', () =>
        this.qdrant.delete(collectionName, {
          filter: this.ownerFilter(documentId, ownerId),
        })
      );
    } catch (error) {
      logger.warn('Qdrant delete preflight failed, continuing with deterministic IDs', {
        documentId,
        ownerId,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    const embedder = await this.getEmbedder();
    let upserted = 0;
    for (let start = 0; start < chunkData.length; start += this.embedBatchSize) {
      const batch = chunkData.slice(start, start + this.embedBatchSize);
      const embeddings = await this.embedTexts(embedder, batch.map((chunk) => chunk.text));

      if (embeddings.length !== batch.length) {
        throw new Error(`Embedding count mismatch in batch: expected ${batch.length}, got ${embeddings.length}`);
      }

      const points = batch.map((chunk, idx) => {
        const vector = Array.from(embeddings[idx] || []);
        if (vector.length !== 384) {
          throw new Error(`Embedding dimension mismatch for chunk ${chunk.index}: expected 384, got ${vector.length}`);
        }

        return {
          id: chunk.id,
          vector,
          payload: {
            chunk_id: chunk.id,
            document_id: documentId,
            user_id: ownerId,
            owner_id: ownerId,
            chunk_index: chunk.index,
            text: chunk.text,
            text_hash: chunk.hash,
            created_at: createdAt,
            expires_at: expiresAt,
            metadata: {
              pipeline: this.pipelineId,
              processed_at: new Date().toISOString(),
            },
          },
        };
      });

      await this.withQdrantRetry('Qdrant upsert', () =>
        this.qdrant.upsert(collectionName, { wait: true, points })
      );

      upserted += points.length;
    }

    const countRes = await this.withQdrantRetry('Qdrant verification count', () =>
      this.qdrant.count(collectionName, {
        filter: this.ownerFilter(documentId, ownerId),
        exact: true,
      } as any)
    );

    const storedCount = Number((countRes as any)?.count ?? -1);
    if (!Number.isFinite(storedCount) || storedCount !== chunkData.length) {
      throw new Error(`Qdrant stored count mismatch: expected ${chunkData.length}, got ${storedCount}`);
    }

    const storedPoints = await this.fetchQdrantPointsForDocument(
      collectionName,
      documentId,
      ownerId,
      chunkData.length,
    );
    this.verifyQdrantPayloadInvariants(documentId, chunkData, storedPoints);

    const documentUpdate = await this.supabase
      .from('au_documents')
      .update({
        status: 'completed',
        error: null,
        expires_at: new Date(expiresAt * 1000).toISOString(),
      })
      .eq('id', documentId);

    if (documentUpdate.error) {
      throw documentUpdate.error;
    }

    logger.info('Document ingestion completed', {
      documentId,
      ownerId,
      embedder: embedder.kind,
      chunkCount: chunkData.length,
      upserted,
      durationMs: Date.now() - startedAt,
    });
  }

  private stablePointId(ownerId: string, documentId: string, chunkIndex: number): string {
    const input = `${ownerId}:${documentId}:${chunkIndex}`;
    const hex = createHash('sha256').update(input).digest('hex').slice(0, 32);
    const b = hex.split('');
    b[12] = '4';
    b[16] = ['8', '9', 'a', 'b'][parseInt(b[16], 16) % 4];
    return `${b.slice(0, 8).join('')}-${b.slice(8, 12).join('')}-${b.slice(12, 16).join('')}-${b.slice(16, 20).join('')}-${b.slice(20, 32).join('')}`;
  }

  /**
   * Deletes all vectors associated with a document ID.
   */
  async deleteDocument(documentId: string, ownerId?: string): Promise<void> {
    const collectionName = 'au_chunks';
    logger.info('Deleting document vectors from Qdrant', { documentId, ownerId: ownerId || null });
    try {
      await this.withQdrantRetry('Qdrant getCollection', () => this.qdrant.getCollection(collectionName));
      await this.withQdrantRetry('Qdrant delete', () =>
        this.qdrant.delete(collectionName, {
          filter: ownerId
            ? this.ownerFilter(documentId, ownerId)
            : {
              must: [
                { key: 'document_id', match: { value: documentId } },
              ],
            },
        })
      );
      logger.info(`Vectors deleted for document ${documentId}`);
    } catch (error: any) {
      if (Number(error?.status) === 404) {
        logger.info(`Collection ${collectionName} not found, skipping deletion.`);
        return;
      }
      logger.error(`Failed to delete document ${documentId} from Qdrant`, error);
      // Do not throw: storage/db cleanup should continue.
    }
  }
}
