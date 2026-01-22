const https = require('https');

const data = JSON.stringify({
  fileName: 'test.txt',
  content: 'Hello, this is a test document upload diagnostic.',
  guestSessionId: '00000000-0000-0000-0000-000000000000' // Use a dummy UUID
});

const options = {
  hostname: 'dhmukdeljiwvvwjdcxgn.supabase.co',
  port: 443,
  path: '/functions/v1/document-upload',
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
