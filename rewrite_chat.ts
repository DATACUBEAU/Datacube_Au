import fs from 'fs';

const chatPath = 'src/lib/api/chat.ts';
let content = fs.readFileSync(chatPath, 'utf8');

// Replace fetchEdgeFunctionResponse / invokeEdgeFunction calls for sendChatMessage
content = content.replace(
  /const { data, error } = await invokeEdgeFunction<any>\(endpoint, {[\s\S]*?}\);/,
  `
  const ticketRes = await fetch('/api/au/vps-ticket', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feature: endpoint })
  });

  if (!ticketRes.ok) {
    const errText = await ticketRes.text();
    throw new Error('Ticket generation failed: ' + errText);
  }

  const ticketData = await ticketRes.json();
  const { ticket, vpsUrl } = ticketData.data || ticketData;

  const res = await fetch(\`\${vpsUrl}/chat/\${endpoint}\`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': \`Bearer \${ticket}\`,
      'x-correlation-id': correlationId,
    },
    body: JSON.stringify(legacyPayload),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error('VPS request failed: ' + errText);
  }

  const data = await res.json();
  const error = null;
`
);

// Do similar for sendChatMessageStream
content = content.replace(
  /const res = await fetchEdgeFunctionResponse\(endpoint, {[\s\S]*?}\);/,
  `
  const ticketRes = await fetch('/api/au/vps-ticket', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feature: endpoint })
  });

  if (!ticketRes.ok) {
    const errText = await ticketRes.text();
    throw new Error('Ticket generation failed: ' + errText);
  }

  const ticketData = await ticketRes.json();
  const { ticket, vpsUrl } = ticketData.data || ticketData;

  const res = await fetch(\`\${vpsUrl}/chat/\${endpoint}\`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': \`Bearer \${ticket}\`,
      'Accept': 'text/event-stream',
      'x-correlation-id': correlationId,
    },
    body: JSON.stringify(payload),
    signal: opts?.signal,
  });
`
);

// Do similar for generatePromptStarters
content = content.replace(
  /const { data, error } = await invokeEdgeFunction<any>\('generate-prompt-starters', {[\s\S]*?}\);/,
  `
  const ticketRes = await fetch('/api/au/vps-ticket', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feature: 'generate-prompt-starters' })
  });

  if (!ticketRes.ok) {
    throw new Error('Ticket generation failed');
  }

  const ticketData = await ticketRes.json();
  const { ticket, vpsUrl } = ticketData.data || ticketData;

  const res = await fetch(\`\${vpsUrl}/generate/prompt-starters\`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': \`Bearer \${ticket}\`,
    },
    body: JSON.stringify({
      documentTitle: request.documentTitle,
      documentContent: request.documentContent,
      userIdea: request.userIdea,
    }),
  });

  let data, error = null;
  if (!res.ok) {
    error = { message: await res.text() };
  } else {
    data = await res.json();
  }
`
);

fs.writeFileSync(chatPath, content);
console.log('done');
