'use strict';

// DNS lookup via Google DNS-over-HTTPS. No local resolver use.

const { sendJson, createCache, fetchTimeout, parseQuery } = require('./_lib');

const cache = createCache();
const CACHE_TTL = 60 * 60 * 1000;
const TIMEOUT = 8000;

const TYPE_CODES = { A: 1, AAAA: 28, MX: 15, TXT: 16, CNAME: 5, NS: 2 };
const CODE_NAMES = { 1: 'A', 2: 'NS', 5: 'CNAME', 15: 'MX', 16: 'TXT', 28: 'AAAA' };
const DOMAIN_RE = /^(?=.{1,253}$)(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))*\.[A-Za-z]{2,}$/;

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return sendJson(res, 204, {});
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });

  const query = parseQuery(req);
  const domain = (query.get('domain') || '').trim().toLowerCase();
  const type = (query.get('type') || 'A').trim().toUpperCase();

  if (!domain || !DOMAIN_RE.test(domain)) {
    return sendJson(res, 400, { error: 'invalid domain' });
  }
  if (!TYPE_CODES[type]) {
    return sendJson(res, 400, { error: 'type must be one of A, AAAA, MX, TXT, CNAME, NS' });
  }

  const cacheKey = 'dns:' + domain + ':' + type;
  const cached = cache.get(cacheKey);
  if (cached) return sendJson(res, 200, cached);

  let data;
  try {
    const url = 'https://dns.google/resolve?name=' + encodeURIComponent(domain) + '&type=' + TYPE_CODES[type];
    const upstream = await fetchTimeout(url, {}, TIMEOUT);
    if (!upstream.ok) throw new Error('upstream status ' + upstream.status);
    data = await upstream.json();
  } catch (err) {
    return sendJson(res, 502, { error: 'DNS lookup failed', detail: String(err && err.message ? err.message : err) });
  }

  const answers = (data.Answer || []).map((a) => ({
    name: a.name,
    type: CODE_NAMES[a.type] || String(a.type),
    TTL: a.TTL,
    data: a.data,
  }));

  const payload = { domain, type, status: data.Status, answers };
  cache.set(cacheKey, payload, CACHE_TTL);
  return sendJson(res, 200, payload);
};
