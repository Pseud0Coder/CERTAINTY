#!/usr/bin/env node
/* Webhook signer for the P0 probes. Mirrors the livekit-server-sdk
   TokenVerifier contract exactly: HS256 over apiSecret, iss = API key,
   exp required, sha256 claim = standard base64 of SHA-256(raw body).
   Usage: node sign_webhook.mjs '<json body>'   (prints the Authorization token) */
import { createHmac, createHash } from 'node:crypto';

const body = process.argv[2] ?? '';
if (!body) { console.error('usage: node sign_webhook.mjs <json-body>'); process.exit(1); }
const key = process.env.LIVEKIT_API_KEY ?? 'fake-key';
const secret = process.env.LIVEKIT_API_SECRET ?? 'fake-secret-p0-experiment';

const b64url = s => Buffer.from(s).toString('base64url');
const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
const sha256 = createHash('sha256').update(body).digest('base64');
const payload = b64url(JSON.stringify({
  iss: key, sub: 'webhook', exp: Math.floor(Date.now() / 1000) + 300, sha256,
}));
const sig = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
console.log(`${header}.${payload}.${sig}`);
