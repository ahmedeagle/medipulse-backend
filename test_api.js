// Test expiry alerts API with a real Keycloak token
// Usage: node test_api.js <keycloak_password>
const https = require('https');
const http = require('http');
const querystring = require('querystring');

const KC_URL = 'https://auth-dev.gx1.ai';
const KC_REALM = 'medipulse';
const KC_CLIENT_ID = 'medipulse-api';
const KC_CLIENT_SECRET = 'eJMBVOkoNHZ8qttJhUE6fiLIL6Y0uWeU';
const USER_EMAIL = 'ahmed.emam.dev2@gmail.com';
const USER_PASS = process.argv[2] || 'test123';
const API_BASE = 'http://localhost:3000/api/v1';

async function fetchJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const lib = parsedUrl.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`${options.method || 'GET'} ${url} → ${res.statusCode}`);
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function main() {
  console.log('\n=== Getting Keycloak token ===');
  const tokenBody = querystring.stringify({
    grant_type: 'password',
    client_id: KC_CLIENT_ID,
    client_secret: KC_CLIENT_SECRET,
    username: USER_EMAIL,
    password: USER_PASS,
    scope: 'openid',
  });

  const tokenRes = await fetchJson(
    `${KC_URL}/realms/${KC_REALM}/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(tokenBody) },
      body: tokenBody,
    }
  );

  if (tokenRes.status !== 200 || !tokenRes.data.access_token) {
    console.error('Token failed:', tokenRes.data);
    process.exit(1);
  }
  const token = tokenRes.data.access_token;
  console.log('Got token ✓');

  const authHeaders = { Authorization: `Bearer ${token}` };

  console.log('\n=== GET /p2p/seller/profile ===');
  const profileRes = await fetchJson(`${API_BASE}/p2p/seller/profile`, { headers: authHeaders });
  console.log('Profile:', JSON.stringify(profileRes.data, null, 2));

  console.log('\n=== GET /p2p/seller/expiry-alerts ===');
  const alertsRes = await fetchJson(`${API_BASE}/p2p/seller/expiry-alerts`, { headers: authHeaders });
  console.log('Expiry alerts:', JSON.stringify(alertsRes.data, null, 2));

  console.log('\n=== GET /notifications/count ===');
  const countRes = await fetchJson(`${API_BASE}/notifications/count`, { headers: authHeaders });
  console.log('Notification count:', JSON.stringify(countRes.data, null, 2));
}

main().catch(err => { console.error('ERROR:', err.message); process.exit(1); });
