'use strict';

// JWT decoder. No signature check unless a secret is supplied, and
// then only HS256 (HMAC-SHA256) is supported.

const crypto = require('crypto');
const { sendJson, parseQuery, readJsonBody } = require('./_lib');

function decodeBase64Url(segment) {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (padded.length % 4)) % 4;
  const buf = Buffer.from(padded + '='.repeat(padLength), 'base64');
  return JSON.parse(buf.toString('utf8'));
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return sendJson(res, 204, {});
  if (req.method !== 'GET' && req.method !== 'POST') {
    return sendJson(res, 405, { error: 'method not allowed' });
  }

  let token = null;
  let secret = null;
  if (req.method === 'GET') {
    const query = parseQuery(req);
    token = query.get('token');
    secret = query.get('secret');
  } else {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      return sendJson(res, 400, { error: String(err.message || err) });
    }
    if (!body || typeof body !== 'object') {
      return sendJson(res, 400, { error: 'JSON body with token is required' });
    }
    token = body.token || null;
    secret = body.secret || null;
  }

  if (!token) return sendJson(res, 400, { error: 'token is required' });

  const parts = String(token).split('.');
  if (parts.length !== 3) {
    return sendJson(res, 400, { error: 'malformed token, expected 3 base64url segments' });
  }

  let header;
  let payload;
  try {
    header = decodeBase64Url(parts[0]);
    payload = decodeBase64Url(parts[1]);
  } catch (err) {
    return sendJson(res, 400, { error: 'malformed token, header or payload is not valid base64url JSON' });
  }
  if (!header || typeof header !== 'object' || !payload || typeof payload !== 'object') {
    return sendJson(res, 400, { error: 'malformed token, header or payload is not a JSON object' });
  }

  let expired = false;
  if (typeof payload.exp === 'number') {
    expired = Math.floor(Date.now() / 1000) >= payload.exp;
  }

  let signatureValid = null;
  if (secret) {
    if (header.alg !== 'HS256') {
      signatureValid = 'unsupported alg';
    } else {
      const signingInput = parts[0] + '.' + parts[1];
      const expected = crypto.createHmac('sha256', secret).update(signingInput).digest('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      signatureValid = timingSafeEqual(expected, parts[2]);
    }
  }

  return sendJson(res, 200, { header, payload, expired, signatureValid });
};
