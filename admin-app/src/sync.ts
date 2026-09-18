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

export interface SyncFileList {
  files: SyncFile[];
  truncated: boolean;
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
  const hasBody = init.body != null;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(`${gatewayUrl(url)}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { ...(hasBody ? { "content-type": "application/json" } : {}), ...(init.headers || {}) },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error || `Sync request failed (${response.status}).`);
    return body;
  } catch (error) {
    if ((error as any)?.name === "AbortError") throw new Error("The sync gateway did not respond within 20 seconds.");
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
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

export async function listSyncFiles(gateway: string, token: string): Promise<SyncFileList> {
  const result = await request(gateway, "/v1/tree", { method: "GET", headers: sessionHeaders(token) });
  return { files: Array.isArray(result?.files) ? result.files : [], truncated: Boolean(result?.truncated) };
}

export async function endSyncSession(gateway: string, token: string): Promise<void> {
  await request(gateway, "/v1/sessions/current", { method: "DELETE", headers: sessionHeaders(token) });
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
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  }
  const binary = chunks.join("");
  return request(gateway, `/v1/content/${path.split("/").map(encodeURIComponent).join("/")}`, {
    method: "PUT",
    headers: sessionHeaders(token),
    body: JSON.stringify({ sha, content: btoa(binary), message: `Update ${path} from Content Studio` }),
  });
}
