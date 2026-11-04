'use strict';

// Current weather for major Indonesian cities, via Open-Meteo
// (free, no key). Source attribution is included in every response.

const { sendJson, createCache, fetchTimeout, parseQuery } = require('./_lib');

const cache = createCache();
const CACHE_TTL = 60 * 60 * 1000;
const TIMEOUT = 8000;

const CITIES = {
  'jakarta': { name: 'Jakarta', latitude: -6.2088, longitude: 106.8456 },
  'surabaya': { name: 'Surabaya', latitude: -7.2575, longitude: 112.7521 },
  'bandung': { name: 'Bandung', latitude: -6.9175, longitude: 107.6191 },
  'medan': { name: 'Medan', latitude: 3.5952, longitude: 98.6722 },
  'semarang': { name: 'Semarang', latitude: -6.9667, longitude: 110.4167 },
  'makassar': { name: 'Makassar', latitude: -5.1477, longitude: 119.4327 },
  'palembang': { name: 'Palembang', latitude: -2.9909, longitude: 104.7566 },
  'tangerang': { name: 'Tangerang', latitude: -6.1702, longitude: 106.6403 },
  'bekasi': { name: 'Bekasi', latitude: -6.2383, longitude: 106.9756 },
  'depok': { name: 'Depok', latitude: -6.4025, longitude: 106.7942 },
  'bogor': { name: 'Bogor', latitude: -6.5971, longitude: 106.8060 },
  'yogyakarta': { name: 'Yogyakarta', latitude: -7.7956, longitude: 110.3695 },
  'malang': { name: 'Malang', latitude: -7.9666, longitude: 112.6326 },
  'denpasar': { name: 'Denpasar', latitude: -8.6705, longitude: 115.2126 },
  'balikpapan': { name: 'Balikpapan', latitude: -1.2379, longitude: 116.8529 },
  'batam': { name: 'Batam', latitude: 1.1300, longitude: 104.0530 },
  'pekanbaru': { name: 'Pekanbaru', latitude: 0.5071, longitude: 101.4478 },
  'padang': { name: 'Padang', latitude: -0.9471, longitude: 100.4172 },
  'bandar lampung': { name: 'Bandar Lampung', latitude: -5.4294, longitude: 105.2618 },
  'banjarmasin': { name: 'Banjarmasin', latitude: -3.3194, longitude: 114.5908 },
};

const CITY_LIST = Object.values(CITIES).map((c) => c.name);

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return sendJson(res, 204, {});
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });

  const query = parseQuery(req);
  const rawCity = (query.get('city') || '').trim();
  const key = rawCity.toLowerCase();
  const city = CITIES[key];
  if (!city) {
    return sendJson(res, 400, { error: 'unknown city', validCities: CITY_LIST });
  }

  const cacheKey = 'weather:' + key;
  const cached = cache.get(cacheKey);
  if (cached) return sendJson(res, 200, cached);

  let data;
  try {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + city.latitude +
      '&longitude=' + city.longitude +
      '&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&timezone=Asia%2FJakarta';
    const upstream = await fetchTimeout(url, {}, TIMEOUT);
    if (!upstream.ok) throw new Error('upstream status ' + upstream.status);
    data = await upstream.json();
  } catch (err) {
    return sendJson(res, 502, { error: 'weather lookup failed', detail: String(err && err.message ? err.message : err) });
  }

  const current = data.current || {};
  const payload = {
    source: 'Open-Meteo',
    sourceUrl: 'https://open-meteo.com/',
    city: city.name,
    latitude: city.latitude,
    longitude: city.longitude,
    timezone: data.timezone || 'Asia/Jakarta',
    time: current.time || null,
    temperature: current.temperature_2m ?? null,
    temperatureUnit: 'C',
    humidity: current.relative_humidity_2m ?? null,
    humidityUnit: '%',
    weatherCode: current.weather_code ?? null,
    windSpeed: current.wind_speed_10m ?? null,
    windSpeedUnit: 'km/h',
  };
  cache.set(cacheKey, payload, CACHE_TTL);
  return sendJson(res, 200, payload);
};
