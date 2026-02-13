const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://dhmukdeljiwvvwjdcxgn.supabase.co';
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRobXVrZGVsaml3dnZ3amRjeGduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTIwNjAyOCwiZXhwIjoyMDgwNzgyMDI4fQ.3lrr0S4UH-9mccuIZAxn1TH82d-SezY19ny8OTaiS2o';

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function createGuest() {
  const { data, error } = await supabase.from('au_guest_sessions').insert({
    fingerprint: 'test-fingerprint-' + Date.now(),
    ip_hash: 'test-ip-hash'
  }).select().single();
  if (error) {
    console.error('Error creating guest:', error);
    process.exit(1);
  }
  console.log('Created guest session:', data.id);
  return data.id;
}

async function test(guestId) {
  const https = require('https');
  const payload = JSON.stringify({
    fileName: 'test-real-guest.txt',
    content: 'Hello, this is a test with a real guest session ID.',
    guestSessionId: guestId
  });

  const options = {
    hostname: 'dhmukdeljiwvvwjdcxgn.supabase.co',
    port: 443,
    path: '/functions/v1/document-upload',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': payload.length,
      'Authorization': `Bearer ${supabaseServiceKey}`,
      'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRobXVrZGVsaml3dnZ3amRjeGduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUyMDYwMjgsImV4cCI6MjA4MDc4MjAyOH0.4Wh-klBrFqFcOWmfLWcOcdnjGTyZ1GuFbnqbFuAsOkI',
      'Origin': 'http://localhost:3000'
    }
  };

  const req = https.request(options, (res) => {
    console.log(`Status: ${res.statusCode}`);
    let body = '';
    res.on('data', (chunk) => body += chunk);
    res.on('end', () => console.log('Body:', body));
  });

  req.on('error', (e) => console.error(e));
  req.write(payload);
  req.end();
}

createGuest().then(test);
