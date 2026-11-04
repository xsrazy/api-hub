'use strict';

// URL shortener backed by a single JSON document in a private Vercel
// Blob store. Read-modify-write against the Blob REST API is used
// (see _lib.js for the verified contract).
//
// RACE NOTE: two concurrent shortens can both read the same document
// version and the later write wins, dropping the earlier code. This
// read-modify-write race is accepted: codes are random 6-char base62
// values, collisions are retried, and a lost code simply means that
// one short link never resolves. A store with conditional writes
// would be needed to remove the race entirely.
// If BLOB_READ_WRITE_TOKEN is absent, the shortener is unavailable
// (503). Nothing is faked.

const crypto = require('crypto');
const { sendJson, parseQuery, readJsonBody, assertPublicHostname, blobReadDoc, blobWriteDoc, blobToken } = require('./_lib');

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

function randomCode() {
  const bytes = crypto.randomBytes(6);
  let code = '';
  for (const b of bytes) code += ALPHABET[b % ALPHABET.length];
  return code;
}

function shortUrlFor(req, code) {
  const host = (req.headers && req.headers.host) || 'localhost';
  const proto = (req.headers && req.headers['x-forwarded-proto']) || 'https';
  return proto + '://' + host + '/s/' + code;
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return sendJson(res, 204, {});

  if (!blobToken()) {
    console.error('[api-hub shorten] no token in env');
    return sendJson(res, 503, { error: 'shortener unavailable' });
  }

  if (req.method === 'GET') {
    const query = parseQuery(req);
    const code = (query.get('code') || '').trim();
    if (!code) return sendJson(res, 400, { error: 'code is required' });
    const { doc, readFailed } = await blobReadDoc();
    if (readFailed) return sendJson(res, 503, { error: 'shortener unavailable' });
    const entry = doc.links[code];
    if (!entry) return sendJson(res, 404, { error: 'code not found' });
    return sendJson(res, 200, { code, url: entry.url, clicks: entry.clicks || 0, createdAt: entry.createdAt });
  }

  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'method not allowed' });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return sendJson(res, 400, { error: String(err.message || err) });
  }
  const target = body && body.url ? String(body.url).trim() : '';
  if (!target) return sendJson(res, 400, { error: 'url is required' });

  let parsed;
  try {
    parsed = new URL(target);
  } catch (err) {
    return sendJson(res, 400, { error: 'invalid url' });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return sendJson(res, 400, { error: 'only http and https urls are allowed' });
  }
  try {
    await assertPublicHostname(parsed.hostname);
  } catch (err) {
    return sendJson(res, 400, { error: 'blocked host' });
  }

  const { doc, readFailed } = await blobReadDoc();
  if (readFailed) return sendJson(res, 503, { error: 'shortener unavailable' });

  let code = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = randomCode();
    if (!doc.links[candidate]) { code = candidate; break; }
  }
  if (!code) return sendJson(res, 503, { error: 'could not generate a unique code, try again' });

  doc.links[code] = { url: parsed.toString(), clicks: 0, createdAt: new Date().toISOString() };
  try {
    await blobWriteDoc(doc);
  } catch (err) {
    return sendJson(res, 503, { error: 'shortener unavailable' });
  }

  return sendJson(res, 200, { code, shortUrl: shortUrlFor(req, code), url: parsed.toString() });
};
