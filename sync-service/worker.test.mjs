import assert from "node:assert/strict";
import test from "node:test";
import worker from "./worker.js";

class MemoryKv {
  values = new Map();

  async get(key, format) {
    const value = this.values.get(key);
    if (value == null) return null;
    return format === "json" ? JSON.parse(value) : value;
  }

  async put(key, value) {
    this.values.set(key, value);
  }

  async delete(key) {
    this.values.delete(key);
  }
}

function environment() {
  return {
    SYNC_STATE: new MemoryKv(),
    SYNC_ADMIN_SECRET: "a-secure-admin-secret-with-at-least-32-characters",
    ALLOWED_ORIGINS: "https://tauri.localhost",
    GITHUB_REPOSITORY: "AHMarius/ahmarius.github.io",
    GITHUB_BRANCH: "main",
  };
}

function request(path, init = {}) {
  return new Request(`https://sync.example${path}`, {
    ...init,
    headers: {
      origin: "https://tauri.localhost",
      "cf-connecting-ip": "192.0.2.1",
      ...(init.headers || {}),
    },
  });
}

async function jsonResponse(response) {
  return { response, body: await response.json() };
}

test("health applies the configured CORS origin", async () => {
  const response = await worker.fetch(request("/v1/health"), environment());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "https://tauri.localhost");
});

test("invalid and oversized JSON receive precise client errors", async () => {
  const env = environment();
  const invalid = await worker.fetch(request("/v1/pairings/claim", { method: "POST", body: "{" }), env);
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /valid JSON/);

  const oversized = await worker.fetch(request("/v1/pairings/claim", {
    method: "POST",
    headers: { "content-length": String(20 * 1024) },
    body: "{}",
  }), env);
  assert.equal(oversized.status, 413);
});

test("pairing is one-time and its session can be revoked immediately", async () => {
  const env = environment();
  const created = await jsonResponse(await worker.fetch(request("/v1/pairings", {
    method: "POST",
    headers: { authorization: `Bearer ${env.SYNC_ADMIN_SECRET}` },
  }), env));
  assert.equal(created.response.status, 201);
  assert.match(created.body.code, /^[A-Z0-9_-]{8,16}$/);

  const claimInit = { method: "POST", body: JSON.stringify({ code: created.body.code, device: "test" }) };
  const claimed = await jsonResponse(await worker.fetch(request("/v1/pairings/claim", claimInit), env));
  assert.equal(claimed.response.status, 201);
  assert.ok(claimed.body.token.length >= 32);

  const replay = await worker.fetch(request("/v1/pairings/claim", claimInit), env);
  assert.equal(replay.status, 401);

  const auth = { authorization: `Bearer ${claimed.body.token}` };
  const revoked = await jsonResponse(await worker.fetch(request("/v1/sessions/current", { method: "DELETE", headers: auth }), env));
  assert.equal(revoked.response.status, 200);
  assert.equal(revoked.body.revoked, true);
  const after = await worker.fetch(request("/v1/sessions/current", { method: "DELETE", headers: auth }), env);
  assert.equal(after.status, 401);
});

test("mobile content paths reject binary and traversal targets", async () => {
  const env = environment();
  const binary = await worker.fetch(request("/v1/content/content/pages/example/assets/photo.png"), env);
  assert.equal(binary.status, 403);
  const traversal = await worker.fetch(request("/v1/content/content/pages/%2E%2E/secret.md"), env);
  assert.equal(traversal.status, 403);
});
