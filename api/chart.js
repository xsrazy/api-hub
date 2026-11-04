'use strict';

// SVG charts generated in pure code. GET uses query params, POST
// accepts a JSON body. Returns image/svg+xml, 640x360.

const { sendJson, escapeXml, parseQuery, readJsonBody } = require('./_lib');

const WIDTH = 640;
const HEIGHT = 360;
const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#f97316', '#6366f1'];

function fmt(n) {
  const v = Math.round(n * 100) / 100;
  return String(v);
}

function parseInput(labels, values, type, title) {
  if (!Array.isArray(labels) || !Array.isArray(values)) {
    return { error: 'labels and values are required' };
  }
  if (labels.length === 0) return { error: 'at least one point is required' };
  if (labels.length > 20) return { error: 'maximum 20 points' };
  if (labels.length !== values.length) return { error: 'labels and values must have the same length' };
  const nums = [];
  for (const v of values) {
    const n = Number(v);
    if (!Number.isFinite(n)) return { error: 'values must be numeric' };
    nums.push(n);
  }
  if (type !== 'bar' && type !== 'line' && type !== 'pie') {
    return { error: 'type must be bar, line, or pie' };
  }
  return { labels: labels.map(String), values: nums, type, title: title || '' };
}

function svgOpen(title) {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + WIDTH + '" height="' + HEIGHT + '" viewBox="0 0 ' + WIDTH + ' ' + HEIGHT + '" role="img">' +
    '<rect width="' + WIDTH + '" height="' + HEIGHT + '" fill="#ffffff"/>' +
    (title ? '<text x="320" y="28" text-anchor="middle" font-family="sans-serif" font-size="18" font-weight="bold" fill="#111827">' + escapeXml(title) + '</text>' : '');
}

function barChart(labels, values, title) {
  const left = 56, right = 16, top = title ? 48 : 24, bottom = 56;
  const plotW = WIDTH - left - right;
  const plotH = HEIGHT - top - bottom;
  const max = Math.max(0, ...values);
  const scale = max > 0 ? plotH / max : 0;
  const slot = plotW / labels.length;
  const barW = Math.min(48, slot * 0.6);
  let s = svgOpen(title);
  s += '<line x1="' + left + '" y1="' + top + '" x2="' + left + '" y2="' + (top + plotH) + '" stroke="#9ca3af"/>';
  s += '<line x1="' + left + '" y1="' + (top + plotH) + '" x2="' + (left + plotW) + '" y2="' + (top + plotH) + '" stroke="#9ca3af"/>';
  // Y axis labels: 0, half, max.
  const ticks = [0, max / 2, max];
  for (const t of ticks) {
    const y = top + plotH - t * scale;
    s += '<text x="' + (left - 6) + '" y="' + (y + 4) + '" text-anchor="end" font-family="sans-serif" font-size="11" fill="#4b5563">' + fmt(t) + '</text>';
    s += '<line x1="' + left + '" y1="' + y + '" x2="' + (left + plotW) + '" y2="' + y + '" stroke="#e5e7eb"/>';
  }
  labels.forEach((label, i) => {
    const h = values[i] * scale;
    const x = left + slot * i + (slot - barW) / 2;
    const y = top + plotH - h;
    s += '<rect x="' + fmt(x) + '" y="' + fmt(y) + '" width="' + fmt(barW) + '" height="' + fmt(h) + '" fill="' + COLORS[i % COLORS.length] + '"/>';
    s += '<text x="' + fmt(x + barW / 2) + '" y="' + (y - 5) + '" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#111827">' + fmt(values[i]) + '</text>';
    s += '<text x="' + fmt(x + barW / 2) + '" y="' + (top + plotH + 18) + '" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#4b5563">' + escapeXml(label) + '</text>';
  });
  return s + '</svg>';
}

function lineChart(labels, values, title) {
  const left = 56, right = 16, top = title ? 48 : 24, bottom = 56;
  const plotW = WIDTH - left - right;
  const plotH = HEIGHT - top - bottom;
  const max = Math.max(...values);
  const min = Math.min(0, ...values);
  const range = max - min || 1;
  const xAt = (i) => labels.length === 1 ? left + plotW / 2 : left + (plotW * i) / (labels.length - 1);
  const yAt = (v) => top + plotH - ((v - min) / range) * plotH;
  let s = svgOpen(title);
  s += '<line x1="' + left + '" y1="' + top + '" x2="' + left + '" y2="' + (top + plotH) + '" stroke="#9ca3af"/>';
  s += '<line x1="' + left + '" y1="' + (top + plotH) + '" x2="' + (left + plotW) + '" y2="' + (top + plotH) + '" stroke="#9ca3af"/>';
  for (const t of [min, (min + max) / 2, max]) {
    const y = yAt(t);
    s += '<text x="' + (left - 6) + '" y="' + (y + 4) + '" text-anchor="end" font-family="sans-serif" font-size="11" fill="#4b5563">' + fmt(t) + '</text>';
    s += '<line x1="' + left + '" y1="' + y + '" x2="' + (left + plotW) + '" y2="' + y + '" stroke="#e5e7eb"/>';
  }
  const points = values.map((v, i) => fmt(xAt(i)) + ',' + fmt(yAt(v))).join(' ');
  s += '<polyline points="' + points + '" fill="none" stroke="#3b82f6" stroke-width="2"/>';
  values.forEach((v, i) => {
    s += '<circle cx="' + fmt(xAt(i)) + '" cy="' + fmt(yAt(v)) + '" r="4" fill="#3b82f6"/>';
    s += '<text x="' + fmt(xAt(i)) + '" y="' + (yAt(v) - 9) + '" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#111827">' + fmt(v) + '</text>';
    s += '<text x="' + fmt(xAt(i)) + '" y="' + (top + plotH + 18) + '" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#4b5563">' + escapeXml(labels[i]) + '</text>';
  });
  return s + '</svg>';
}

function pieChart(labels, values, title) {
  const total = values.reduce((a, b) => a + b, 0);
  const cx = 220, cy = 190, r = 120;
  let s = svgOpen(title);
  if (total <= 0) {
    s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="#e5e7eb"/>';
    s += '<text x="' + cx + '" y="' + cy + '" text-anchor="middle" font-family="sans-serif" font-size="13" fill="#4b5563">no data</text>';
  } else {
    let angle = -Math.PI / 2;
    values.forEach((v, i) => {
      const sweep = (v / total) * Math.PI * 2;
      const x1 = cx + r * Math.cos(angle);
      const y1 = cy + r * Math.sin(angle);
      const x2 = cx + r * Math.cos(angle + sweep);
      const y2 = cy + r * Math.sin(angle + sweep);
      const large = sweep > Math.PI ? 1 : 0;
      if (v > 0) {
        s += '<path d="M ' + fmt(cx) + ' ' + fmt(cy) + ' L ' + fmt(x1) + ' ' + fmt(y1) +
          ' A ' + r + ' ' + r + ' 0 ' + large + ' 1 ' + fmt(x2) + ' ' + fmt(y2) + ' Z" fill="' + COLORS[i % COLORS.length] + '"/>';
      }
      angle += sweep;
    });
  }
  // Legend.
  labels.forEach((label, i) => {
    const y = 90 + i * 24;
    const pct = total > 0 ? Math.round((values[i] / total) * 100) : 0;
    s += '<rect x="380" y="' + (y - 12) + '" width="14" height="14" fill="' + COLORS[i % COLORS.length] + '"/>';
    s += '<text x="402" y="' + y + '" font-family="sans-serif" font-size="13" fill="#111827">' +
      escapeXml(label) + ' (' + fmt(values[i]) + ', ' + pct + '%)</text>';
  });
  return s + '</svg>';
}

function sendSvg(res, svg) {
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.statusCode = 200;
  res.end(svg);
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.statusCode = 204;
    return res.end();
  }

  let input;
  try {
    if (req.method === 'GET') {
      const query = parseQuery(req);
      const labels = (query.get('labels') || '').split(',').map((x) => x.trim()).filter((x) => x !== '');
      const values = (query.get('values') || '').split(',').map((x) => x.trim()).filter((x) => x !== '');
      input = parseInput(labels, values, query.get('type') || 'bar', query.get('title') || '');
    } else if (req.method === 'POST') {
      const body = await readJsonBody(req);
      if (!body) return sendJson(res, 400, { error: 'JSON body is required' });
      input = parseInput(body.labels, body.values, body.type || 'bar', body.title || '');
    } else {
      return sendJson(res, 405, { error: 'method not allowed' });
    }
  } catch (err) {
    return sendJson(res, 400, { error: String(err.message || err) });
  }

  if (input.error) return sendJson(res, 400, { error: input.error });

  const svg = input.type === 'line'
    ? lineChart(input.labels, input.values, input.title)
    : input.type === 'pie'
      ? pieChart(input.labels, input.values, input.title)
      : barChart(input.labels, input.values, input.title);
  return sendSvg(res, svg);
};
