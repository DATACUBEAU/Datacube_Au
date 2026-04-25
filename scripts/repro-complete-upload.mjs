#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const baseUrl = (process.env.BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const authToken = (process.env.AUTH_BEARER_TOKEN || '').trim();
const authCookie = (process.env.AUTH_COOKIE || '').trim();
const uploadFile = process.env.UPLOAD_FILE || 'tests/fixtures/upload-sanity.txt';
const documentType = (process.env.DOCUMENT_TYPE || 'main_textbook').trim();
const parentDocumentId = (process.env.PARENT_DOCUMENT_ID || '').trim();
const correlationId = (process.env.CORRELATION_ID || crypto.randomUUID()).trim();

if (!authToken && !authCookie) {
  console.error('Missing AUTH_BEARER_TOKEN or AUTH_COOKIE.');
  process.exit(1);
}

if (!fs.existsSync(uploadFile)) {
  console.error(`Upload file not found: ${uploadFile}`);
  process.exit(1);
}

const fileBuffer = fs.readFileSync(uploadFile);
const fileName = path.basename(uploadFile);
const fileSize = fileBuffer.length;

const jobId = crypto.randomUUID();
const documentId = crypto.randomUUID();

const makeHeaders = () => {
  const headers = {
    'Content-Type': 'application/json',
    'x-correlation-id': correlationId,
  };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  if (authCookie) headers.Cookie = authCookie;
  return headers;
};

async function readJsonOrText(response) {
  const raw = await response.text().catch(() => '');
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

async function main() {
  console.log('[repro-upload] baseUrl:', baseUrl);
  console.log('[repro-upload] correlationId:', correlationId);
  console.log('[repro-upload] jobId:', jobId);
  console.log('[repro-upload] documentId:', documentId);

  const initiatePayload = {
    action: 'initiate',
    fileName,
    fileSize,
    documentType,
    jobId,
    uploadId: jobId,
    documentId,
    correlationId,
  };
  if (parentDocumentId) {
    initiatePayload.parentDocumentId = parentDocumentId;
  }

  const initiateRes = await fetch(`${baseUrl}/api/proxy/document-upload`, {
    method: 'POST',
    headers: makeHeaders(),
    body: JSON.stringify(initiatePayload),
  });
  const initiateBody = await readJsonOrText(initiateRes);
  console.log('[repro-upload] initiate status:', initiateRes.status);
  console.log('[repro-upload] initiate body:', initiateBody);
  if (!initiateRes.ok || !initiateBody?.uploadUrl) {
    process.exit(1);
  }

  const uploadRes = await fetch(initiateBody.uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': initiateBody.contentType || 'application/octet-stream',
      'x-upsert': 'true',
    },
    body: fileBuffer,
  });
  const uploadText = await uploadRes.text().catch(() => '');
  console.log('[repro-upload] signed upload status:', uploadRes.status);
  if (!uploadRes.ok) {
    console.log('[repro-upload] signed upload body:', uploadText);
    process.exit(1);
  }

  const completePayload = {
    action: 'complete',
    documentId,
    jobId,
    uploadId: jobId,
    correlationId,
    fileName,
    fileSize,
    mimeType: initiateBody.contentType,
    path: initiateBody.path,
    bucket: initiateBody.bucket,
  };

  const completeRes = await fetch(`${baseUrl}/api/proxy/document-upload`, {
    method: 'POST',
    headers: makeHeaders(),
    body: JSON.stringify(completePayload),
  });
  const completeBody = await readJsonOrText(completeRes);
  console.log('[repro-upload] complete status:', completeRes.status);
  console.log('[repro-upload] complete body:', completeBody);

  if (!completeRes.ok) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('[repro-upload] failed:', error?.stack || String(error));
  process.exit(1);
});
