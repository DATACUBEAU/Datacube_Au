const https = require('https');

const supabaseUrl = 'https://dhmukdeljiwvvwjdcxgn.supabase.co';
const serviceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRobXVrZGVsaml3dnZ3amRjeGduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTIwNjAyOCwiZXhwIjoyMDgwNzgyMDI4fQ.3lrr0S4UH-9mccuIZAxn1TH82d-SezY19ny8OTaiS2o';

const options = {
  hostname: 'dhmukdeljiwvvwjdcxgn.supabase.co',
  port: 443,
  path: '/functions/v1/apply-migration',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${serviceKey}`,
    'apikey': serviceKey,
    'X-Migration-Token': 'super-secret-migration-token'
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
