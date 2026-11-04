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
  if (!entry || !entry.url) {
    var safeCode = code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    var html = "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Short link not found - API Hub</title><style>body{font-family:system-ui,sans-serif;background:#0b1020;color:#f2f5ff;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;text-align:center;padding:24px}h1{font-size:28px;margin:0 0 12px}p{color:#b8c2dd;line-height:1.6}a{color:#7c8aff}</style></head><body><main><h1>Short link not found</h1><p>No short link exists for code &ldquo;" + safeCode + "&rdquo;. It may have expired or the link may be mistyped.</p><p><a href=\"/\">Back to API Hub</a></p></main></body></html>";
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.statusCode = 404;
    res.end(html);
    return;
  }

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
