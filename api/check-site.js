'use strict';

// Server-side probe of a public URL: status, timing, redirect chain,
// page title and meta description. Private hosts are blocked.

const { sendJson, fetchTimeout, assertPublicHostname, parseQuery } = require('./_lib');

const TIMEOUT = 8000;
const MAX_BYTES = 256 * 1024;
const MAX_HOPS = 5;

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function extractMeta(html) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1].replace(/\s+/g, ' ').trim()) : '';
  let description = '';
  const metas = html.match(/<meta[^>]*>/gi) || [];
  for (const tag of metas) {
    if (/name\s*=\s*["']description["']/i.test(tag)) {
      const content = tag.match(/content\s*=\s*["']([^"']*)["']/i);
      if (content) { description = decodeEntities(content[1].trim()); break; }
    }
  }
  if (!description) {
    for (const tag of metas) {
      if (/property\s*=\s*["']og:description["']/i.test(tag)) {
        const content = tag.match(/content\s*=\s*["']([^"']*)["']/i);
        if (content) { description = decodeEntities(content[1].trim()); break; }
      }
    }
  }
  return { title, description };
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return sendJson(res, 204, {});
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });

  const query = parseQuery(req);
  const target = (query.get('url') || '').trim();
  if (!target) return sendJson(res, 400, { error: 'url is required' });

  let url;
  try {
    url = new URL(target);
  } catch (err) {
    return sendJson(res, 400, { error: 'invalid url' });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return sendJson(res, 400, { error: 'only http and https urls are allowed' });
  }

  const started = Date.now();
  let current = url.toString();
  let redirects = 0;
  let upstream;
  try {
    for (;;) {
      const parsed = new URL(current);
      await assertPublicHostname(parsed.hostname);
      upstream = await fetchTimeout(current, { redirect: 'manual' }, TIMEOUT);
      const status = upstream.status;
      if (status >= 300 && status < 400) {
        const location = upstream.headers.get('location');
        if (!location || redirects >= MAX_HOPS) break;
        current = new URL(location, current).toString();
        redirects += 1;
        continue;
      }
      break;
    }
  } catch (err) {
    if (err && err.message === 'blocked host') {
      return sendJson(res, 400, { error: 'blocked host' });
    }
    return sendJson(res, 502, { error: 'upstream request failed', detail: String(err && err.message ? err.message : err) });
  }

  // Read at most MAX_BYTES for title/description extraction.
  let html = '';
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
          try { await reader.cancel(); } catch (err) { /* ignore */ }
          break;
        }
        chunks.push(Buffer.from(value));
      }
      html = Buffer.concat(chunks).toString('utf8');
    } else {
      html = await upstream.text();
    }
  } catch (err) {
    html = '';
  }

  const { title, description } = extractMeta(html);
  const finalUrl = new URL(current);
  return sendJson(res, 200, {
    url: current,
    status: upstream.status,
    ms: Date.now() - started,
    redirects,
    title,
    description,
    favicon: finalUrl.origin + '/favicon.ico',
  });
};
