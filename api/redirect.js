'use strict';

// Redirect for short codes: 302 to the stored URL, best-effort click
// increment. Same Blob document and token handling as shorten.js.
// See _lib.js for the verified Blob REST contract and the
// read-modify-write race note.

const { sendJson, parseQuery, blobReadDoc, blobWriteDoc, blobToken } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return sendJson(res, 204, {});
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });

  if (!blobToken()) {
    return sendJson(res, 503, { error: 'shortener unavailable' });
  }

  const query = parseQuery(req);
  const code = (query.get('code') || '').trim();
  if (!code) return sendJson(res, 400, { error: 'code is required' });

  const { doc, readFailed } = await blobReadDoc();
  if (readFailed) return sendJson(res, 503, { error: 'shortener unavailable' });
  const entry = doc.links[code];
  if (!entry || !entry.url) return sendJson(res, 404, { error: 'code not found' });

  // Best-effort click increment: a failed write must not block the redirect.
  try {
    entry.clicks = (entry.clicks || 0) + 1;
    await blobWriteDoc(doc);
  } catch (err) {
    // Ignore: the redirect below still happens.
  }

  res.setHeader('Location', entry.url);
  res.statusCode = 302;
  res.end();
};
