'use strict';

// Hashing, HMAC, password strength, and base64 / URL encoding helpers.
// Crypto module only.

const crypto = require('crypto');
const { sendJson, parseQuery } = require('./_lib');

const ALGOS = ['sha256', 'sha1', 'sha512', 'md5'];

function strength(text) {
  let score = 0;
  if (text.length >= 8) score += 1;
  if (text.length >= 12) score += 1;
  const classes = [
    /[a-z]/.test(text),
    /[A-Z]/.test(text),
    /[0-9]/.test(text),
    /[^A-Za-z0-9]/.test(text),
  ].filter(Boolean).length;
  if (classes >= 2) score += 1;
  if (classes >= 4) score += 1;
  if (score > 4) score = 4;
  const label = score <= 1 ? 'weak' : score === 2 ? 'fair' : score === 3 ? 'good' : 'strong';
  return { score, label, length: text.length, variety: classes };
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return sendJson(res, 204, {});
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });

  const query = parseQuery(req);
  const text = query.get('text');
  if (text === null || text === '') {
    return sendJson(res, 400, { error: 'text is required' });
  }
  const mode = query.get('mode') || 'hash';
  const algo = (query.get('algo') || 'sha256').toLowerCase();
  const key = query.get('key');

  if (mode === 'strength') {
    return sendJson(res, 200, { mode, text, ...strength(text) });
  }
  if (mode === 'b64encode') {
    return sendJson(res, 200, { mode, text, result: Buffer.from(text, 'utf8').toString('base64') });
  }
  if (mode === 'b64decode') {
    try {
      const decoded = Buffer.from(text, 'base64').toString('utf8');
      return sendJson(res, 200, { mode, text, result: decoded });
    } catch (err) {
      return sendJson(res, 400, { error: 'invalid base64 input' });
    }
  }
  if (mode === 'urlencode') {
    return sendJson(res, 200, { mode, text, result: encodeURIComponent(text) });
  }
  if (mode === 'urldecode') {
    try {
      return sendJson(res, 200, { mode, text, result: decodeURIComponent(text) });
    } catch (err) {
      return sendJson(res, 400, { error: 'invalid url-encoded input' });
    }
  }
  if (mode === 'hmac') {
    if (!key) return sendJson(res, 400, { error: 'key is required for hmac mode' });
    if (!ALGOS.includes(algo)) return sendJson(res, 400, { error: 'algo must be one of ' + ALGOS.join(', ') });
    const result = crypto.createHmac(algo, key).update(text).digest('hex');
    return sendJson(res, 200, { mode, algo, text, result });
  }
  if (mode === 'hash') {
    if (!ALGOS.includes(algo)) return sendJson(res, 400, { error: 'algo must be one of ' + ALGOS.join(', ') });
    const result = crypto.createHash(algo).update(text).digest('hex');
    return sendJson(res, 200, { mode, algo, text, result });
  }
  return sendJson(res, 400, { error: 'unknown mode', validModes: ['hash', 'hmac', 'strength', 'b64encode', 'b64decode', 'urlencode', 'urldecode'] });
};
