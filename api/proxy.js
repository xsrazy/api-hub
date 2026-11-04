'use strict';

// GET-only sandbox proxy with SSRF protection. Redirect hops are
// re-checked against the public-host rule, max 3 hops.

const { sendJson, fetchTimeout, assertPublicHostname, checkRateLimit, getClientIp, parseQuery } = require('./_lib');

const TIMEOUT = 8000;
const MAX_BYTES = 256 * 1024;
const MAX_HOPS = 3;

async function fetchWithRedirects(startUrl, ms) {
  let url = startUrl;
  let hops = 0;
  let res;
  const started = Date.now();
  for (;;) {
    const parsed = new URL(url);
    await assertPublicHostname(parsed.hostname);
    res = await fetchTimeout(url, { redirect: 'manual' }, ms);
    const status = res.status;
    if (status >= 300 && status < 400) {
      const location = res.headers.get('location');
      if (!location || hops >= MAX_HOPS) {
        return { res, ms: Date.now() - started, finalUrl: url, hops };
      }
      url = new URL(location, url).toString();
      hops += 1;
      continue;
    }
    return { res, ms: Date.now() - started, finalUrl: url, hops };
  }
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return sendJson(res, 204, {});
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'only GET is allowed' });

  const ip = getClientIp(req);
  if (!checkRateLimit(ip, 30, 60 * 1000)) {
    return sendJson(res, 429, { error: 'rate limit exceeded, 30 requests per minute' });
  }

  const query = parseQuery(req);
  const target = query.get('url') || '';
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

  let outcome;
  try {
    outcome = await fetchWithRedirects(target, TIMEOUT);
  } catch (err) {
    if (err && err.message === 'blocked host') {
      return sendJson(res, 400, { error: 'blocked host' });
    }
    return sendJson(res, 502, { error: 'upstream request failed', detail: String(err && err.message ? err.message : err) });
  }

  const { res: upstream, ms, finalUrl } = outcome;
  const contentType = upstream.headers.get('content-type') || '';

  // Read at most MAX_BYTES from the body.
  let truncated = false;
  let body = '';
  try {
    const reader = upstream.body && upstream.body.getReader ? upstream.body.getReader() : null;
    if (reader) {
      const chunks = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_BYTES) {
          const keep = value.slice(0, Math.max(0, MAX_BYTES - (total - value.byteLength)));
          if (keep.byteLength) chunks.push(Buffer.from(keep));
          truncated = true;
          try { await reader.cancel(); } catch (err) { /* ignore */ }
          break;
        }
        chunks.push(Buffer.from(value));
      }
      body = Buffer.concat(chunks).toString('utf8');
    } else {
      const text = await upstream.text();
      if (Buffer.byteLength(text) > MAX_BYTES) {
        body = Buffer.from(text).subarray(0, MAX_BYTES).toString('utf8');
        truncated = true;
      } else {
        body = text;
      }
    }
  } catch (err) {
    return sendJson(res, 502, { error: 'failed reading upstream body' });
  }

  return sendJson(res, 200, {
    status: upstream.status,
    ms,
    url: finalUrl,
    headers: { 'content-type': contentType },
    body,
    truncated,
  });
};
