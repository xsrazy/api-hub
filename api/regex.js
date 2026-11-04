'use strict';

// Two modes: regex tester, and 5-field cron explainer with next runs.
// Cron evaluation steps minute by minute, capped at 7 days.

const { sendJson, parseQuery, readJsonBody } = require('./_lib');

const MONTH_NAMES = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const DOW_NAMES = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

function parseCronField(field, min, max, names) {
  const values = new Set();
  const parts = String(field).split(',');
  for (let part of parts) {
    part = part.trim().toLowerCase();
    if (!part) throw new Error('empty cron field');
    let step = 1;
    let range = part;
    let hasStep = false;
    if (part.includes('/')) {
      const split = part.split('/');
      range = split[0];
      step = parseInt(split[1], 10);
      hasStep = true;
      if (!Number.isInteger(step) || step < 1) throw new Error('invalid cron step');
    }
    let start;
    let end;
    if (range === '*') {
      start = min;
      end = max;
    } else if (range.includes('-')) {
      const [a, b] = range.split('-');
      start = names ? (names[a] !== undefined ? names[a] : parseInt(a, 10)) : parseInt(a, 10);
      end = names ? (names[b] !== undefined ? names[b] : parseInt(b, 10)) : parseInt(b, 10);
    } else {
      const single = names && names[range] !== undefined ? names[range] : parseInt(range, 10);
      if (!Number.isInteger(single)) throw new Error('invalid cron value: ' + range);
      start = single;
      // "5/15" means 5, 20, 35, 50: a stepped single value runs to max.
      end = hasStep ? max : single;
    }
    if (!Number.isInteger(start) || !Number.isInteger(end)) throw new Error('invalid cron value');
    if (start < min || end > max || start > end) throw new Error('cron value out of range');
    for (let v = start; v <= end; v += step) values.add(v);
  }
  return values;
}

function describeField(values, min, max, singular, plural) {
  if (values.size === max - min + 1) return 'every ' + singular;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return 'at ' + sorted[0];
  return plural + ' ' + sorted.join(', ');
}

function parseCron(expr) {
  const fields = String(expr).trim().split(/\s+/);
  if (fields.length !== 5) throw new Error('cron expression must have 5 fields: minute hour day-of-month month day-of-week');
  const minutes = parseCronField(fields[0], 0, 59, null);
  const hours = parseCronField(fields[1], 0, 23, null);
  const doms = parseCronField(fields[2], 1, 31, null);
  const months = parseCronField(fields[3], 1, 12, MONTH_NAMES);
  const dows = parseCronField(fields[4], 0, 7, DOW_NAMES);
  // Cron treats 7 as Sunday too.
  if (dows.has(7)) { dows.delete(7); dows.add(0); }
  const domRestricted = fields[2] !== '*';
  const dowRestricted = fields[4] !== '*';
  return { minutes, hours, doms, months, dows, domRestricted, dowRestricted };
}

function cronMatches(schedule, date) {
  if (!schedule.minutes.has(date.getUTCMinutes())) return false;
  if (!schedule.hours.has(date.getUTCHours())) return false;
  if (!schedule.months.has(date.getUTCMonth() + 1)) return false;
  const domOk = schedule.doms.has(date.getUTCDate());
  const dowOk = schedule.dows.has(date.getUTCDay());
  if (schedule.domRestricted && schedule.dowRestricted) return domOk || dowOk;
  if (schedule.domRestricted) return domOk;
  if (schedule.dowRestricted) return dowOk;
  return true;
}

function nextRuns(schedule, count) {
  const runs = [];
  const cursor = new Date();
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  const limit = 7 * 24 * 60; // 10080 iterations, 7 days
  for (let i = 0; i < limit && runs.length < count; i++) {
    if (cronMatches(schedule, cursor)) runs.push(new Date(cursor).toISOString());
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }
  return runs;
}

function cronDescription(schedule, fields) {
  const minutePart = fields[0] === '*' ? 'every minute' : 'at minute ' + [...schedule.minutes].sort((a, b) => a - b).join(', ');
  const hourPart = describeField(schedule.hours, 0, 23, 'hour', 'hours');
  const domPart = schedule.domRestricted ? 'on day ' + [...schedule.doms].sort((a, b) => a - b).join(', ') + ' of the month' : '';
  const monthPart = schedule.months.size === 12 ? '' : 'in month ' + [...schedule.months].sort((a, b) => a - b).join(', ');
  const dowNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dowPart = schedule.dowRestricted
    ? 'on ' + [...schedule.dows].sort((a, b) => a - b).map((d) => dowNames[d]).join(', ')
    : '';
  const joiner = schedule.domRestricted && schedule.dowRestricted ? ' or ' : ', ';
  const parts = [minutePart, hourPart, domPart, monthPart, dowPart].filter(Boolean);
  return 'Runs ' + parts.join(joiner) + '.';
}

async function handleRegex(req, res, pattern, text, flags) {
  if (pattern === null || pattern === undefined || pattern === '') {
    return sendJson(res, 400, { error: 'pattern is required' });
  }
  if (text === null || text === undefined) {
    return sendJson(res, 400, { error: 'text is required' });
  }
  const safeFlags = String(flags || '').replace(/[^gimsuy]/g, '');
  let re;
  try {
    re = new RegExp(pattern, safeFlags.includes('g') ? safeFlags : safeFlags + 'g');
  } catch (err) {
    return sendJson(res, 400, { error: 'invalid pattern: ' + err.message });
  }
  const matches = [];
  const started = Date.now();
  try {
    let m;
    while ((m = re.exec(text)) !== null) {
      matches.push(m[0]);
      if (matches.length >= 100) break;
      if (Date.now() - started > 1000) break;
      if (m[0] === '') re.lastIndex += 1;
      if (re.lastIndex > text.length) break;
    }
  } catch (err) {
    return sendJson(res, 400, { error: 'pattern evaluation failed: ' + err.message });
  }
  return sendJson(res, 200, { pattern, flags: safeFlags, matches, count: matches.length });
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return sendJson(res, 204, {});
  if (req.method !== 'GET' && req.method !== 'POST') {
    return sendJson(res, 405, { error: 'method not allowed' });
  }

  let input = {};
  if (req.method === 'GET') {
    const query = parseQuery(req);
    input = {
      pattern: query.get('pattern'),
      text: query.get('text'),
      flags: query.get('flags'),
      cron: query.get('cron'),
    };
  } else {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      return sendJson(res, 400, { error: String(err.message || err) });
    }
    if (!body || typeof body !== 'object') {
      return sendJson(res, 400, { error: 'JSON body is required' });
    }
    input = body;
  }

  if (input.cron) {
    let schedule;
    let fields;
    try {
      fields = String(input.cron).trim().split(/\s+/);
      schedule = parseCron(input.cron);
    } catch (err) {
      return sendJson(res, 400, { error: 'invalid cron expression: ' + err.message });
    }
    const runs = nextRuns(schedule, 3);
    return sendJson(res, 200, {
      cron: String(input.cron).trim(),
      description: cronDescription(schedule, fields),
      nextRuns: runs,
    });
  }

  return handleRegex(req, res, input.pattern, input.text, input.flags);
};
