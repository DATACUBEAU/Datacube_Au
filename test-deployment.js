const https = require('https');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !anonKey) {
  console.error('Missing URL or Anon Key');
  process.exit(1);
}

const hostname = new URL(supabaseUrl).hostname;

function testFunction(name, key, body = '{}') {
  return new Promise((resolve, reject) => {
    const options = {
      hostname,
      port: 443,
      path: `/functions/v1/${name}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
        'apikey': key,
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({ status: res.statusCode, body: data });
      });
    });

    req.on('error', (e) => {
      reject(e);
    });

    req.write(body);
    req.end();
  });
}

async function runTests() {
  console.log('Testing admin-handler...');
  try {
    // Admin handler usually requires service role
    const adminRes = await testFunction('admin-handler', serviceKey, JSON.stringify({ action: 'health_check' })); // Assuming health check or similar exists, or just empty
    console.log('admin-handler status:', adminRes.status);
    console.log('admin-handler body:', adminRes.body.substring(0, 200));
  } catch (e) {
    console.error('admin-handler failed:', e.message);
  }

  console.log('\nTesting au-chat...');
  try {
    // au-chat usually requires user token, but let's see if it responds to anon (401 is success for deployment)
    const chatRes = await testFunction('au-chat', anonKey, JSON.stringify({ messages: [] }));
    console.log('au-chat status:', chatRes.status); // Expect 401 or 400 or 200
    console.log('au-chat body:', chatRes.body.substring(0, 200));
  } catch (e) {
    console.error('au-chat failed:', e.message);
  }
}

runTests();
