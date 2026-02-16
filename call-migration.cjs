const https = require('https');

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const migrationToken = process.env.MIGRATION_TOKEN;

if (!supabaseUrl || !serviceKey || !migrationToken) {
  throw new Error('Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or MIGRATION_TOKEN in environment');
}

const hostname = new URL(supabaseUrl).hostname;

const options = {
  hostname,
  port: 443,
  path: '/functions/v1/apply-migration',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${serviceKey}`,
    'apikey': serviceKey,
    'X-Migration-Token': migrationToken
  }
};

const req = https.request(options, (res) => {
  console.log(`Status: ${res.statusCode}`);
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    console.log('Body:', body);
    process.exit(res.statusCode === 200 ? 0 : 1);
  });
});

req.on('error', (e) => {
  console.error(e);
  process.exit(1);
});

req.end();
