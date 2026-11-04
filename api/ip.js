'use strict';

// Client info from request headers only. No external calls.

const { sendJson, getClientIp } = require('./_lib');

function parseUserAgent(ua) {
  let browser = 'Unknown';
  let os = 'Unknown';
  let device = 'desktop';

  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/OPR\//i.test(ua) || /Opera/i.test(ua)) browser = 'Opera';
  else if (/Chrome\//i.test(ua)) browser = 'Chrome';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Safari\//i.test(ua)) browser = 'Safari';

  if (/Windows NT/i.test(ua)) os = 'Windows';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
  else if (/Mac OS X/i.test(ua)) os = 'macOS';
  else if (/Linux/i.test(ua)) os = 'Linux';
  else if (/CrOS/i.test(ua)) os = 'ChromeOS';

  if (/iPad/i.test(ua)) device = 'tablet';
  else if (/Mobi|Android|iPhone|iPod/i.test(ua)) device = 'mobile';
  else if (/Tablet/i.test(ua)) device = 'tablet';

  return { browser, os, device };
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return sendJson(res, 204, {});
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });

  const ua = (req.headers && req.headers['user-agent']) || '';
  const parsed = parseUserAgent(ua);
  return sendJson(res, 200, {
    ip: getClientIp(req),
    userAgent: ua,
    browser: parsed.browser,
    os: parsed.os,
    device: parsed.device,
    language: (req.headers && req.headers['accept-language']) || '',
  });
};
