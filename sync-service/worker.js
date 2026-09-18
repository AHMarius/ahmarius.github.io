/**
 * AH Marius Content Studio sync gateway.
 *
 * Deploy this as a Cloudflare Worker. It is deliberately dependency-free so
 * the audit surface is small: GitHub App credentials remain Worker secrets;
 * phone/laptop clients receive only opaque, revocable session tokens.
 */

const GITHUB_API = 'https://api.github.com';
const MAX_CONTENT_BYTES = 8 * 1024 * 1024;
const PAIRING_TTL_SECONDS = 10 * 60;
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

class HttpError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

function error(message, status = 400, headers = {}) {
  return json({ error: message }, status, headers);
}

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomToken(bytes = 32) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return base64Url(value);
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

async function sameSecret(actual, expected) {
  if (!actual || !expected) return false;
  const [left, right] = await Promise.all([sha256(actual), sha256(expected)]);
  if (left.length !== right.length) return false;
  let delta = 0;
  for (let i = 0; i < left.length; i += 1) delta |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return delta === 0;
}

function cors(request, env) {
  const origin = request.headers.get('origin');
  const allowed = String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (!origin || !allowed.includes(origin)) return { vary: 'Origin' };
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, PUT, DELETE, POST, OPTIONS',
    vary: 'Origin',
  };
}

function bearer(request) {
  const value = request.headers.get('authorization') || '';
  return value.startsWith('Bearer ') ? value.slice(7).trim() : '';
}

async function requireAdmin(request, env, headers) {
  if (!(await sameSecret(bearer(request), env.SYNC_ADMIN_SECRET))) {
    return error('Unauthorized.', 401, headers);
  }
  return null;
}

async function requireSession(request, env, headers) {
  const token = bearer(request);
  if (!token || token.length < 32) return { response: error('Unauthorized.', 401, headers) };
  const key = `session:${await sha256(token)}`;
  const session = await env.SYNC_STATE.get(key, 'json');
  if (!session || !session.expires_at || Date.parse(session.expires_at) <= Date.now()) {
    if (session) await env.SYNC_STATE.delete(key);
    return { response: error('Session expired. Pair this device again.', 401, headers) };
  }
  return { session, key };
}

async function readJson(request, limit = MAX_CONTENT_BYTES) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > limit) throw new HttpError('Request body is too large.', 413);
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > limit) throw new HttpError('Request body is too large.', 413);
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError('Request body must be valid JSON.', 400);
  }
}

function allowedPath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 300) return null;
  const clean = value.replace(/^\/+/, '');
  if (clean.split('/').some((part) => !part || part === '.' || part === '..' || part.includes('\\'))) return null;
  // Mobile sync only handles canonical source files. Generated site output and
  // workflow configuration stay desktop/CI owned, preventing remote takeover.
  const canonical = clean === 'content/site-settings.json' || clean.startsWith('content/pages/') || clean.startsWith('content/projects/');
  return canonical && /\.(?:md|ya?ml|json)$/i.test(clean)
    ? clean
    : null;
}

async function rateLimit(request, env, bucket, limit, windowSeconds, headers) {
  const address = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
  const key = `rate:${bucket}:${await sha256(address.split(',')[0].trim())}`;
  const current = Number(await env.SYNC_STATE.get(key) || 0);
  if (current >= limit) return error('Too many requests. Try again later.', 429, { ...headers, 'retry-after': String(windowSeconds) });
  await env.SYNC_STATE.put(key, String(current + 1), { expirationTtl: windowSeconds });
  return null;
}

function githubPath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

function pemBytes(pem) {
  const compact = String(pem || '')
    .replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  if (!compact) throw new Error('GitHub App private key is not configured.');
  const binary = atob(compact);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function githubAppJwt(env) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const payload = base64Url(new TextEncoder().encode(JSON.stringify({ iat: now - 30, exp: now + 540, iss: env.GITHUB_APP_ID })));
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemBytes(env.GITHUB_APP_PRIVATE_KEY),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signed = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${base64Url(new Uint8Array(signed))}`;
}

let installationToken = null;

async function githubToken(env) {
  if (installationToken && installationToken.expiresAt > Date.now() + 60_000) return installationToken.value;
  const jwt = await githubAppJwt(env);
  const response = await fetch(`${GITHUB_API}/app/installations/${encodeURIComponent(env.GITHUB_INSTALLATION_ID)}/access_tokens`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${jwt}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'ahmarius-content-studio-sync',
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!response.ok) throw new Error(`GitHub App authentication failed (${response.status}).`);
  const body = await response.json();
  installationToken = { value: body.token, expiresAt: Date.parse(body.expires_at) };
  return installationToken.value;
}

async function github(request, env, path, init = {}) {
  const token = await githubToken(env);
  const response = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'user-agent': 'ahmarius-content-studio-sync',
      'x-github-api-version': '2022-11-28',
      ...(init.headers || {}),
    },
  });
  return response;
}

function repoRef(env, path) {
  return `/repos/${env.GITHUB_REPOSITORY}/contents/${githubPath(path)}?ref=${encodeURIComponent(env.GITHUB_BRANCH || 'main')}`;
}

function repoWritePath(env, path) {
  return `/repos/${env.GITHUB_REPOSITORY}/contents/${githubPath(path)}`;
}

async function contentRequest(request, env, path, headers) {
  if (request.method === 'GET') {
    const response = await github(request, env, repoRef(env, path));
    if (response.status === 404) return error('Content not found.', 404, headers);
    if (!response.ok) return error(`GitHub content read failed (${response.status}).`, 502, headers);
    const item = await response.json();
    if (Array.isArray(item) || item.type !== 'file') return error('Only files can be synced.', 400, headers);
    return json({ path, sha: item.sha, content: String(item.content || '').replace(/\s/g, ''), encoding: 'base64' }, 200, headers);
  }

  if (request.method === 'PUT') {
    const payload = await readJson(request);
    if (typeof payload.content !== 'string' || !/^[A-Za-z0-9+/_=-]*$/.test(payload.content)) {
      return error('content must be base64-encoded.', 400, headers);
    }
    if (payload.content.length > Math.ceil(MAX_CONTENT_BYTES * 4 / 3)) return error('Content is too large.', 413, headers);
    if (payload.sha != null && !/^[a-f0-9]{40}$/i.test(payload.sha)) return error('Invalid content revision.', 400, headers);
    const message = String(payload.message || `Update ${path}`).replace(/[\r\n]/g, ' ').slice(0, 200);
    const response = await github(request, env, repoWritePath(env, path), {
      method: 'PUT',
      body: JSON.stringify({ content: payload.content, message, sha: payload.sha || undefined, branch: env.GITHUB_BRANCH || 'main' }),
    });
    if (response.status === 409 || response.status === 422) return error('This file changed remotely. Refresh and resolve the conflict before saving.', 409, headers);
    if (!response.ok) return error(`GitHub content write failed (${response.status}).`, 502, headers);
    const body = await response.json();
    return json({ path, sha: body.content?.sha, commit: body.commit?.sha }, 200, headers);
  }

  if (request.method === 'DELETE') {
    const payload = await readJson(request, 32 * 1024);
    if (!/^[a-f0-9]{40}$/i.test(String(payload.sha || ''))) return error('A current content revision is required to delete.', 400, headers);
    const message = String(payload.message || `Delete ${path}`).replace(/[\r\n]/g, ' ').slice(0, 200);
    const response = await github(request, env, repoWritePath(env, path), {
      method: 'DELETE',
      body: JSON.stringify({ message, sha: payload.sha, branch: env.GITHUB_BRANCH || 'main' }),
    });
    if (response.status === 409 || response.status === 422) return error('This file changed remotely. Refresh before deleting.', 409, headers);
    if (!response.ok) return error(`GitHub content delete failed (${response.status}).`, 502, headers);
    const body = await response.json();
    return json({ path, commit: body.commit?.sha, deleted: true }, 200, headers);
  }
  return error('Method not allowed.', 405, headers);
}

async function contentTree(env, headers) {
  const branch = env.GITHUB_BRANCH || 'main';
  const response = await github(null, env, `/repos/${env.GITHUB_REPOSITORY}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
  if (!response.ok) return error(`GitHub content list failed (${response.status}).`, 502, headers);
  const body = await response.json();
  const entries = Array.isArray(body.tree) ? body.tree : [];
  const files = entries
    .filter((entry) => entry.type === 'blob' && allowedPath(entry.path))
    .slice(0, 2_000)
    .map((entry) => ({ path: entry.path, sha: entry.sha, size: entry.size || 0 }));
  return json({ branch, files, truncated: Boolean(body.truncated) || entries.length > 2_000 }, 200, headers);
}

async function createPairing(request, env, headers) {
  const limited = await rateLimit(request, env, 'create-pairing', 10, 60, headers);
  if (limited) return limited;
  const denied = await requireAdmin(request, env, headers);
  if (denied) return denied;
  const code = randomToken(9).toUpperCase().slice(0, 12);
  const expiresAt = new Date(Date.now() + PAIRING_TTL_SECONDS * 1000).toISOString();
  await env.SYNC_STATE.put(`pairing:${await sha256(code)}`, JSON.stringify({ expires_at: expiresAt }), { expirationTtl: PAIRING_TTL_SECONDS });
  return json({ code, expires_at: expiresAt }, 201, headers);
}

async function claimPairing(request, env, headers) {
  const limited = await rateLimit(request, env, 'claim-pairing', 12, 300, headers);
  if (limited) return limited;
  const payload = await readJson(request, 16 * 1024);
  const code = String(payload.code || '').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{8,16}$/.test(code)) return error('Invalid pairing code.', 400, headers);
  const key = `pairing:${await sha256(code)}`;
  const pairing = await env.SYNC_STATE.get(key, 'json');
  if (!pairing || Date.parse(pairing.expires_at) <= Date.now()) return error('Pairing code expired. Create a new one on your laptop.', 401, headers);
  await env.SYNC_STATE.delete(key); // pairing codes are strictly one-time use.
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  await env.SYNC_STATE.put(
    `session:${await sha256(token)}`,
    JSON.stringify({ scopes: ['content:read', 'content:write'], expires_at: expiresAt, device: String(payload.device || 'mobile').slice(0, 80) }),
    { expirationTtl: SESSION_TTL_SECONDS },
  );
  return json({ token, expires_at: expiresAt }, 201, headers);
}

export default {
  async fetch(request, env) {
    const headers = cors(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    const url = new URL(request.url);
    try {
      if (url.pathname === '/v1/health' && request.method === 'GET') return json({ ok: true }, 200, headers);
      if (url.pathname === '/v1/pairings' && request.method === 'POST') return createPairing(request, env, headers);
      if (url.pathname === '/v1/pairings/claim' && request.method === 'POST') return claimPairing(request, env, headers);
      if (url.pathname === '/v1/tree' && request.method === 'GET') {
        const auth = await requireSession(request, env, headers);
        if (auth.response) return auth.response;
        return contentTree(env, headers);
      }
      if (url.pathname === '/v1/sessions/current' && request.method === 'DELETE') {
        const auth = await requireSession(request, env, headers);
        if (auth.response) return auth.response;
        await env.SYNC_STATE.delete(auth.key);
        return json({ revoked: true }, 200, headers);
      }
      if (url.pathname.startsWith('/v1/content/')) {
        const path = allowedPath(decodeURIComponent(url.pathname.slice('/v1/content/'.length)));
        if (!path) return error('This path is not available to mobile sync.', 403, headers);
        const auth = await requireSession(request, env, headers);
        if (auth.response) return auth.response;
        return contentRequest(request, env, path, headers);
      }
      return error('Not found.', 404, headers);
    } catch (cause) {
      if (cause instanceof HttpError) return error(cause.message, cause.status, headers);
      console.error('sync gateway failure', cause);
      return error('The sync service could not complete the request.', 502, headers);
    }
  },
};
