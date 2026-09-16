export interface PairingCode {
  code: string;
  expires_at: string;
}

export interface SyncSession {
  token: string;
  expires_at: string;
}

export interface SyncFile {
  path: string;
  sha: string;
  size: number;
}

function gatewayUrl(raw: string): string {
  const url = new URL(raw.trim());
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error("The sync gateway must use HTTPS (HTTP is allowed only on localhost).");
  }
  return url.toString().replace(/\/$/, "");
}

async function request(url: string, path: string, init: RequestInit): Promise<any> {
  const response = await fetch(`${gatewayUrl(url)}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || `Sync request failed (${response.status}).`);
  return body;
}

/** Creates a one-time phone pairing code. The admin secret is never stored. */
export async function createPhonePairing(gateway: string, adminSecret: string): Promise<PairingCode> {
  if (adminSecret.trim().length < 32) throw new Error("The sync admin secret is missing or too short.");
  return request(gateway, "/v1/pairings", {
    method: "POST",
    headers: { authorization: `Bearer ${adminSecret.trim()}` },
  });
}

export async function checkSyncGateway(gateway: string): Promise<void> {
  const result = await request(gateway, "/v1/health", { method: "GET" });
  if (!result?.ok) throw new Error("The sync gateway did not report a healthy status.");
}

export async function claimPhonePairing(gateway: string, code: string): Promise<SyncSession> {
  return request(gateway, "/v1/pairings/claim", {
    method: "POST",
    body: JSON.stringify({ code, device: navigator.userAgent.slice(0, 80) }),
  });
}

function sessionHeaders(token: string): HeadersInit {
  return { authorization: `Bearer ${token}` };
}

export async function listSyncFiles(gateway: string, token: string): Promise<SyncFile[]> {
  const result = await request(gateway, "/v1/tree", { method: "GET", headers: sessionHeaders(token) });
  return Array.isArray(result?.files) ? result.files : [];
}

export async function readSyncFile(gateway: string, token: string, path: string): Promise<{ sha: string; content: string }> {
  const result = await request(gateway, `/v1/content/${path.split("/").map(encodeURIComponent).join("/")}`, {
    method: "GET", headers: sessionHeaders(token),
  });
  const binary = atob(String(result.content || ""));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return { sha: result.sha, content: new TextDecoder().decode(bytes) };
}

export async function writeSyncFile(gateway: string, token: string, path: string, sha: string, content: string): Promise<{ sha: string }> {
  const bytes = new TextEncoder().encode(content);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return request(gateway, `/v1/content/${path.split("/").map(encodeURIComponent).join("/")}`, {
    method: "PUT",
    headers: sessionHeaders(token),
    body: JSON.stringify({ sha, content: btoa(binary), message: `Update ${path} from Content Studio` }),
  });
}
