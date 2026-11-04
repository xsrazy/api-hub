'use strict';

// Static dummy data for sandbox use. No external calls, no fake
// claims: every record here is plainly placeholder data.

const { sendJson, parseQuery } = require('./_lib');

const USERS = [
  { id: 1, name: 'Alex Morgan', username: 'alex.morgan', email: 'alex@example.com', city: 'New York', role: 'member' },
  { id: 2, name: 'Sarah Johnson', username: 'sarah.johnson', email: 'sarah@example.com', city: 'London', role: 'member' },
  { id: 3, name: 'Michael Chen', username: 'michael.chen', email: 'michael@example.com', city: 'Berlin', role: 'admin' },
  { id: 4, name: 'Emma Wilson', username: 'emma.wilson', email: 'emma@example.com', city: 'Tokyo', role: 'member' },
  { id: 5, name: 'Daniel Brown', username: 'daniel.brown', email: 'daniel@example.com', city: 'Sydney', role: 'member' },
  { id: 6, name: 'Olivia Davis', username: 'olivia.davis', email: 'olivia@example.com', city: 'Toronto', role: 'member' },
  { id: 7, name: 'James Miller', username: 'james.miller', email: 'james@example.com', city: 'Paris', role: 'moderator' },
  { id: 8, name: 'Sophia Garcia', username: 'sophia.garcia', email: 'sophia@example.com', city: 'Amsterdam', role: 'member' },
  { id: 9, name: 'Liam Martinez', username: 'liam.martinez', email: 'liam@example.com', city: 'Singapore', role: 'member' },
  { id: 10, name: 'Isabella Lee', username: 'isabella.lee', email: 'isabella@example.com', city: 'San Francisco', role: 'member' },
];

const POSTS = [
  { id: 1, userId: 1, title: 'Learning APIs for the first time', body: 'A short guide to trying API endpoints without installing anything.' },
  { id: 2, userId: 2, title: 'Tips for writing documentation', body: 'Good documentation starts with examples you can run.' },
  { id: 3, userId: 3, title: 'Understanding JSON', body: 'JSON is a lightweight, easy-to-read data exchange format.' },
  { id: 4, userId: 4, title: 'Commonly used HTTP status codes', body: '200, 400, 404, and 500 mean different things, learn them before debugging.' },
  { id: 5, userId: 5, title: 'Why caching matters', body: 'The right cache makes an API feel fast without overloading the upstream.' },
  { id: 6, userId: 6, title: 'Rate limits are your friend', body: 'Request limits keep a service stable for everyone.' },
  { id: 7, userId: 7, title: 'Reading error responses', body: 'A clear error message saves more time than a status code alone.' },
  { id: 8, userId: 8, title: 'Simple API versioning', body: 'Change the API contract gradually so old clients do not break.' },
  { id: 9, userId: 9, title: 'Testing endpoints with curl', body: 'A single curl command is enough to check an endpoint response shape.' },
  { id: 10, userId: 10, title: 'Keeping APIs free', body: 'Open source and aggressive caching keep free services alive.' },
];

const PRODUCTS = [
  { id: 1, name: 'Gayo Arabica Coffee 250g', price: 75000, currency: 'IDR', stock: 42, category: 'Beverages' },
  { id: 2, name: 'Premium Jasmine Tea 100g', price: 32000, currency: 'IDR', stock: 120, category: 'Beverages' },
  { id: 3, name: 'Mega Mendung Hand-drawn Batik', price: 450000, currency: 'IDR', stock: 8, category: 'Fashion' },
  { id: 4, name: 'Rattan Woven Bag', price: 185000, currency: 'IDR', stock: 15, category: 'Crafts' },
  { id: 5, name: 'Sumbawa Forest Honey 500ml', price: 120000, currency: 'IDR', stock: 30, category: 'Food' },
  { id: 6, name: 'Balado Cassava Chips', price: 25000, currency: 'IDR', stock: 200, category: 'Food' },
  { id: 7, name: 'Bamboo Decorative Lamp', price: 95000, currency: 'IDR', stock: 25, category: 'Decor' },
  { id: 8, name: 'Lemongrass Herbal Soap', price: 18000, currency: 'IDR', stock: 150, category: 'Care' },
  { id: 9, name: 'Leather Notebook', price: 65000, currency: 'IDR', stock: 60, category: 'Stationery' },
  { id: 10, name: 'Teak Wood Keychain', price: 12000, currency: 'IDR', stock: 300, category: 'Souvenir' },
];

const TODOS = [
  { id: 1, userId: 1, title: 'Read the API documentation', completed: true },
  { id: 2, userId: 1, title: 'Try the search endpoint', completed: false },
  { id: 3, userId: 2, title: 'Test the proxy with a public URL', completed: false },
  { id: 4, userId: 2, title: 'Build a chart from sample data', completed: true },
  { id: 5, userId: 3, title: 'Check the directory status', completed: false },
  { id: 6, userId: 4, title: 'Hash a sample password', completed: false },
  { id: 7, userId: 5, title: 'Decode a sample JWT token', completed: true },
  { id: 8, userId: 6, title: 'Check a city weather', completed: false },
  { id: 9, userId: 7, title: 'Test a regex pattern', completed: false },
  { id: 10, userId: 8, title: 'Shorten a sample URL', completed: false },
];

const DATA = { users: USERS, posts: POSTS, products: PRODUCTS, todos: TODOS };

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return sendJson(res, 204, {});
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });

  const query = parseQuery(req);
  const type = query.get('type') || '';
  if (!Object.prototype.hasOwnProperty.call(DATA, type)) {
    return sendJson(res, 400, { error: 'unknown type', validTypes: Object.keys(DATA) });
  }
  let limit = parseInt(query.get('limit') || '5', 10);
  if (Number.isNaN(limit) || limit < 1) limit = 5;
  if (limit > 50) limit = 50;

  const data = DATA[type].slice(0, limit);
  return sendJson(res, 200, { type, count: data.length, data });
};
