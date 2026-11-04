'use strict';

// Server-side paged catalog for the preview frontend. Same data and
// same ordering as the production client-side filter (no-key first,
// then name), but only the requested page is sent, so the initial
// load no longer downloads all 10 shards (~590 KB). Hidden entries
// are never returned, exactly as in production.

const fs = require('fs');
const path = require('path');
const { sendJson, parseQuery } = require('./_lib');

const PAGE_SIZE_DEFAULT = 60;
const PAGE_SIZE_MAX = 60;

let cachedEntries = null;
let cachedCategories = null;

function loadCatalog() {
  if (cachedEntries) return { entries: cachedEntries, categories: cachedCategories };
  const dir = path.join(__dirname, '..');
  let shards = [];
  try {
    shards = fs.readdirSync(dir).filter(function (name) {
      return /^catalog-\d+\.json$/.test(name);
    }).sort();
  } catch (err) { /* ignore */ }
  const entries = [];
  for (const file of shards) {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    } catch (err) {
      continue;
    }
    const list = Array.isArray(parsed) ? parsed : parsed.entries || parsed.items || [];
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      if (item.hidden) continue;
      entries.push(item);
    }
  }
  const categorySet = new Set();
  for (const entry of entries) {
    if (entry.category) categorySet.add(String(entry.category));
  }
  cachedEntries = entries;
  cachedCategories = Array.from(categorySet).sort(function (a, b) {
    return a.localeCompare(b, 'id');
  });
  return { entries, categories: cachedCategories };
}

function authRank(auth) {
  if (auth === 'none') return 0;
  if (auth === 'apiKey') return 1;
  if (auth === 'OAuth') return 2;
  return 3;
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return sendJson(res, 204, {});
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });

  const query = parseQuery(req);
  const q = (query.get('q') || '').trim().toLowerCase();
  const category = query.get('category') || 'all';
  const auth = query.get('auth') || 'all';
  const ownOnly = query.get('own') === '1';
  let page = parseInt(query.get('page') || '1', 10);
  if (!Number.isFinite(page) || page < 1) page = 1;
  let pageSize = parseInt(query.get('pageSize') || String(PAGE_SIZE_DEFAULT), 10);
  if (!Number.isFinite(pageSize) || pageSize < 1) pageSize = PAGE_SIZE_DEFAULT;
  if (pageSize > PAGE_SIZE_MAX) pageSize = PAGE_SIZE_MAX;

  const { entries, categories } = loadCatalog();
  const filtered = entries.filter(function (entry) {
    if (ownOnly && entry.source !== 'own') return false;
    if (category !== 'all' && entry.category !== category) return false;
    if (auth !== 'all' && entry.auth !== auth) return false;
    if (q) {
      const haystack = ((entry.name || '') + ' ' + (entry.description || '')).toLowerCase();
      if (haystack.indexOf(q) === -1) return false;
    }
    return true;
  });
  filtered.sort(function (a, b) {
    const rankDiff = authRank(a.auth) - authRank(b.auth);
    if (rankDiff !== 0) return rankDiff;
    return String(a.name || '').localeCompare(String(b.name || ''), 'id');
  });

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (page > totalPages) page = totalPages;
  const start = (page - 1) * pageSize;
  const pageEntries = filtered.slice(start, start + pageSize);

  return sendJson(res, 200, {
    total,
    totalDisplayed: entries.length,
    ownCount: entries.filter(function (e) { return e.source === 'own'; }).length,
    page,
    pageSize,
    totalPages,
    categories,
    entries: pageEntries,
  });
};
