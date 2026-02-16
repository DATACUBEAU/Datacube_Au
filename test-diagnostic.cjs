const https = require('https');

const supabaseUrl = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const accessToken = process.env.SUPABASE_ACCESS_TOKEN;

if (!supabaseUrl || !anonKey || !accessToken) {
  throw new Error('Missing SUPABASE_URL, SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY), or SUPABASE_ACCESS_TOKEN in environment');
}

const data = JSON.stringify({
  fileName: 'test.txt',
  content: 'Hello, this is a test document upload diagnostic.'
});

const hostname = new URL(supabaseUrl).hostname;

const options = {
  hostname,
  port: 443,
  path: '/functions/v1/document-upload',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length,
    'Authorization': `Bearer ${accessToken}`,
    'apikey': anonKey,
    'Origin': 'http://localhost:3000'
  }
};

const req = https.request(options, (res) => {
  console.log(`Status: ${res.statusCode}`);
  console.log('Headers:', JSON.stringify(res.headers, null, 2));

  let body = '';
  res.on('data', (chunk) => {
    body += chunk;
  });

  res.on('end', () => {
    console.log('Body:', body);
  });
});

req.on('error', (e) => {
  console.error(`Problem with request: ${e.message}`);
});

req.write(data);
req.end();
