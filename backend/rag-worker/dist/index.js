"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const supabase_js_1 = require("@supabase/supabase-js");
const worker_1 = require("./worker");
const ingestion_1 = require("./ingestion");
const utils_1 = require("./utils");
async function main() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const openRouterApiKey = process.env.OPENROUTER_API_KEY;
    if (!supabaseUrl || !supabaseServiceKey || !openRouterApiKey) {
        utils_1.logger.error('Missing environment variables. Please check SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and OPENROUTER_API_KEY.');
        process.exit(1);
    }
    const supabase = (0, supabase_js_1.createClient)(supabaseUrl, supabaseServiceKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    });
    const ingestion = new ingestion_1.IngestionService(supabase, {
        apiKey: openRouterApiKey,
        httpReferer: process.env.OPENROUTER_HTTP_REFERER,
        xTitle: process.env.OPENROUTER_X_TITLE,
    });
    const worker = new worker_1.RAGWorker(supabase, ingestion);
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
    utils_1.logger.error('Application crash', err);
    process.exit(1);
});
