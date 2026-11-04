'use strict';

// Liveness probes for the directory entries in the catalog shards
// at the project root. Failures are data, not errors.

const fs = require('fs');
const path = require('path');
const { sendJson, fetchTimeout, parseQuery } = require('./_lib');

const SLICE_SIZE = 300;
const SLICE_BUCKET_MS = 15 * 60 * 1000;
const ENTRY_CACHE_TTL = 48 * 60 * 60 * 1000;
const TIMEOUT = 5000;
const CONCURRENCY = 12;
const BOT_WALL_STATUSES = new Set([403, 418, 429]);

// Per-entry results merged across invocations, keyed by entry id.
// Each stored result carries its own checkedAt. Entries expire after
// 48 hours; serverless instances recycle, so a cold start may return
// no result for an id until its slice is probed again. To avoid that,
// a seed snapshot (status-seed-*.json, written by a full background
// pass) is loaded once per instance and fills ids not yet probed
// live; rolling checks then refresh every slice within one rotation.
const resultCache = new Map();

function cachedResult(id) {
  const stored = resultCache.get(id);
  if (!stored) return null;
  if (Date.now() > stored.expiresAt) {
    resultCache.delete(id);
    return null;
  }
  return stored.result;
}

function storeResult(result) {
  resultCache.set(result.id, { result, expiresAt: Date.now() + ENTRY_CACHE_TTL });
}

let seedLoaded = false;

function loadSeed() {
  if (seedLoaded) return;
  seedLoaded = true;
  const dir = path.join(__dirname, '..');
  let files = [];
  try {
    files = fs.readdirSync(dir).filter(function (name) {
      return /^status-seed(-\d+)?\.json$/.test(name);
    }).sort();
  } catch (err) { /* ignore */ }
  for (const file of files) {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    } catch (err) { continue; }
    const generatedAt = parsed && parsed.generatedAt;
    const list = parsed && Array.isArray(parsed.entries) ? parsed.entries : [];
    for (const row of list) {
      if (!Array.isArray(row) || row.length < 4) continue;
      const id = String(row[0]);
      if (resultCache.has(id)) continue;
      const code = row[1];
      const checkedMs = Date.parse(generatedAt);
      if (Number.isNaN(checkedMs)) continue;
      if (Date.now() > checkedMs + ENTRY_CACHE_TTL) continue;
      let result;
      if (code === 1) {
        result = { id, ok: true, status: row[2], ms: row[3], checkedAt: generatedAt };
      } else if (code === 2) {
        result = { id, ok: null, state: 'botwall', status: row[2], ms: row[3], checkedAt: generatedAt };
      } else if (code === 3) {
        result = { id, ok: null, state: 'neutral', status: null, ms: null, checkedAt: generatedAt };
      } else {
        result = { id, ok: false, status: row[2], ms: row[3], checkedAt: generatedAt };
      }
      resultCache.set(id, { result, expiresAt: checkedMs + ENTRY_CACHE_TTL });
    }
  }
}

// When the current slice was last probed. A slice is probed at most
// once per 15-minute bucket unless ?fresh=1 forces it sooner, so
// repeated page loads reuse the merged cache instead of re-probing
// upstream. The slice for an invocation is picked by the current
// 15-minute bucket, so a cron hitting this endpoint every 15 minutes
// advances one slice per tick even with no visitors.
let lastSliceProbe = { index: -1, bucket: -1, at: 0 };

function catalogFiles() {
  const dir = path.join(__dirname, '..');
  let shards = [];
  try {
    shards = fs.readdirSync(dir).filter(function (name) {
      return /^catalog-\d+\.json$/.test(name);
    }).sort();
  } catch (err) { /* ignore */ }
  const files = shards.length ? shards : ['catalog.json'];
  return files;
}

function loadEntries() {
  const entries = [];
  const warnings = [];
  for (const file of catalogFiles()) {
    const full = path.join(__dirname, '..', file);
    let raw;
    try {
      raw = fs.readFileSync(full, 'utf8');
    } catch (err) {
      warnings.push(file + ' not found');
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      warnings.push(file + ' is not valid JSON');
      continue;
    }
    const list = Array.isArray(parsed) ? parsed : parsed.entries || parsed.items || [];
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const url = item.url || item.href || '';
      if (!url) continue;
      entries.push({
        id: String(item.id || item.name || item.title || url),
        url: String(url),
        source: String(item.source || ''),
        sandbox: item.sandbox && typeof item.sandbox === 'object' ? item.sandbox : null,
      });
    }
  }
  return { entries, warnings };
}

async function probeUrl(id, target, started) {
  try {
    const res = await fetchTimeout(target, { redirect: 'follow' }, TIMEOUT);
    // Do not download the body for a liveness probe.
    try { if (res.body && res.body.cancel) await res.body.cancel(); } catch (err) { /* ignore */ }
    // 403/418/429 is the bot-wall class from the original sweep: the
    // site answers, but blocks automated probes. It is not a failure
    // for human visitors, so it carries no down label downstream.
    if (BOT_WALL_STATUSES.has(res.status)) {
      return { id, ok: null, state: 'botwall', status: res.status, ms: Date.now() - started };
    }
    return { id, ok: res.status >= 200 && res.status < 400, status: res.status, ms: Date.now() - started };
  } catch (err) {
    return { id, ok: false, status: 0, ms: Date.now() - started };
  }
}

// Own APIs need their documented example parameters: probing the bare
// path answers 400 ("parameter required") even when the tool works.
// Build the probe URL from the sandbox example definition. Entries
// whose example is not a plain GET (e.g. a POST that creates data)
// are never probed automatically: firing the example would perform a
// write on every check, so they report a neutral state instead.
function ownProbeTarget(entry, origin) {
  const def = entry.sandbox;
  if (!def) return null;
  const method = String(def.method || 'GET').toUpperCase();
  if (method !== 'GET') return { neutral: true };
  const base = typeof def.url === 'string' && def.url ? def.url : entry.url;
  if (!base) return null;
  const params = Array.isArray(def.params) ? def.params : [];
  const qs = new URLSearchParams();
  for (const param of params) {
    if (!param || !param.key) continue;
    const value = param.value;
    if (value === undefined || value === null || value === '') continue;
    qs.set(String(param.key), String(value));
  }
  let path = base;
  const query = qs.toString();
  if (query) path += (base.indexOf('?') !== -1 ? '&' : '?') + query;
  if (path.indexOf('{') !== -1 || path.indexOf('}') !== -1) return { neutral: true };
  const target = path.charAt(0) === '/' && origin ? origin + path : path;
  return { neutral: false, target };
}

async function probe(entry, origin) {
  const started = Date.now();
  if (entry.source === 'own') {
    const planned = ownProbeTarget(entry, origin);
    if (planned && planned.neutral) {
      return { id: entry.id, ok: null, state: 'neutral', status: null, ms: null };
    }
    if (planned && planned.target) {
      return probeUrl(entry.id, planned.target, started);
    }
  }
  const target = entry.url.charAt(0) === '/' && origin ? origin + entry.url : entry.url;
  return probeUrl(entry.id, target, started);
}

async function probeAll(entries, origin) {
  const results = new Array(entries.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= entries.length) return;
      results[index] = await probe(entries[index], origin);
    }
  }
  const workers = [];
  for (let i = 0; i < Math.min(CONCURRENCY, entries.length); i++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return sendJson(res, 204, {});
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });

  const query = parseQuery(req);
  const fresh = query.get('fresh') === '1';

  loadSeed();

  const { entries, warnings } = loadEntries();
  if (entries.length === 0 && warnings.length > 0) {
    return sendJson(res, 503, { error: 'catalog unavailable', warnings });
  }

  // Rolling checks: non-own entries, in file order including hidden
  // ones, are split into slices of 300. The slice for this invocation
  // is picked by the current 15-minute bucket, so the full set is
  // covered in 8 slices x 15 minutes = 2 hours. At ~70 ms per entry
  // and concurrency 12, a 300-entry slice takes roughly 20 seconds,
  // well under the 60-second function limit. Own entries are cheap
  // and are probed on every invocation.
  const ownEntries = entries.filter(function (entry) { return entry.source === 'own'; });
  const nonOwnEntries = entries.filter(function (entry) { return entry.source !== 'own'; });
  const sliceCount = Math.max(1, Math.ceil(nonOwnEntries.length / SLICE_SIZE));
  const bucket = Math.floor(Date.now() / SLICE_BUCKET_MS);
  const sliceIndex = bucket % sliceCount;
  const slice = nonOwnEntries.slice(sliceIndex * SLICE_SIZE, (sliceIndex + 1) * SLICE_SIZE);
  const sliceDue = fresh || lastSliceProbe.bucket !== bucket;

  const toProbe = [];
  const seenIds = new Set();
  for (const entry of ownEntries.concat(sliceDue ? slice : [])) {
    if (seenIds.has(entry.id)) continue;
    seenIds.add(entry.id);
    toProbe.push(entry);
  }

  const proto = (req.headers && req.headers['x-forwarded-proto']) || 'https';
  const host = req.headers && req.headers.host;
  const origin = host ? proto + '://' + host : null;
  const now = new Date().toISOString();
  const probed = await probeAll(toProbe, origin);
  for (const result of probed) {
    storeResult(Object.assign({}, result, { checkedAt: now }));
  }
  if (sliceDue) lastSliceProbe = { index: sliceIndex, bucket: bucket, at: Date.now() };

  // Merge: every id probed on this or an earlier invocation (within
  // 48 hours) is included with its own checkedAt. Ids never probed
  // yet are omitted; the frontend renders those as unknown.
  const merged = [];
  const emittedIds = new Set();
  for (const entry of entries) {
    if (emittedIds.has(entry.id)) continue;
    emittedIds.add(entry.id);
    const stored = cachedResult(entry.id);
    if (stored) merged.push(stored);
  }
  const payload = { checkedAt: now, entries: merged };
  if (warnings.length) payload.warnings = warnings;
  return sendJson(res, 200, payload);
};
