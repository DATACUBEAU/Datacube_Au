import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { OpenAI } from 'openai';
import { RAGWorker } from './worker';
import { IngestionService } from './ingestion';
import { logger } from './utils';

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const openaiApiKey = process.env.OPENAI_API_KEY;

  if (!supabaseUrl || !supabaseServiceKey || !openaiApiKey) {
    logger.error('Missing environment variables. Please check SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and OPENAI_API_KEY.');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  const openai = new OpenAI({
    apiKey: openaiApiKey,
  });

  const ingestion = new IngestionService(supabase, openai);
  const worker = new RAGWorker(supabase, ingestion);

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    worker.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    worker.stop();
    process.exit(0);
  });

  await worker.start();
}

main().catch(err => {
  logger.error('Application crash', err);
  process.exit(1);
});
