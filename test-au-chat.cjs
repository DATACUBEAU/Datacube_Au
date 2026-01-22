const { createClient } = require('@supabase/supabase-js');
const https = require('https');

const data = JSON.stringify({
  messages: [{ role: 'user', content: 'hello' }],
  useRAG: false
});

const options = {
  hostname: 'dhmukdeljiwvvwjdcxgn.supabase.co',
  port: 443,
  path: '/functions/v1/au-chat',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length,
    'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRobXVrZGVsaml3dnZ3amRjeGduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTIwNjAyOCwiZXhwIjoyMDgwNzgyMDI4fQ.3lrr0S4UH-9mccuIZAxn1TH82d-SezY19ny8OTaiS2o',
    'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRobXVrZGVsaml3dnZ3amRjeGduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUyMDYwMjgsImV4cCI6MjA4MDc4MjAyOH0.4Wh-klBrFqFcOWmfLWcOcdnjGTyZ1GuFbnqbFuAsOkI',
    'Origin': 'http://localhost:3000'
  }
};

const req = https.request(options, (res) => {
  console.log(`Status: ${res.statusCode}`);
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    console.log('Body:', body);
  });
});

req.on('error', (e) => {
  console.error(e);
});

req.write(data);
req.end();
