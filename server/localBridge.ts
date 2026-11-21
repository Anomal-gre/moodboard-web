import { randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Connect, Plugin } from 'vite';
import { isClipId, MAX_CLIP_BASE64_LENGTH, readWebClip, type ClipDestination, type IncomingWebClip } from '../src/features/clipper/clipProtocol';
import { MAX_NATIVE_FILE_BYTES, nativeDesignFileName } from '../src/desktop/designFilePolicy';
import { focusOrLaunchLocalMosaApp } from './focusMosa';

const MAX_QUEUE_ITEMS = 24;
const MAX_QUEUE_BYTES = 64 * 1024 * 1024;
const ACTIVE_TAB_TTL = 12_000;
const BRIDGE_VERSION = 2;

interface QueuedClip {
  clip: IncomingWebClip;
  projectId: string;
  size: number;
}

interface LocalWorkspace {
  pending: Map<string, QueuedClip>;
  receipts: Map<string, ClipDestination>;
  destination?: ClipDestination;
  activity: number;
  lastAppSeen: number;
  lastExtensionSeen: number;
  language: 'vi' | 'en';
}

class BodyTooLargeError extends Error {}

function json(res: ServerResponse, status: number, data: object) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function loopbackOrigin(req: IncomingMessage): string | null {
  const host = req.headers.host;
  const remote = req.socket.remoteAddress;
  const localConnection = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  return localConnection && host && /^(127\.0\.0\.1|localhost)(:\d{1,5})?$/i.test(host)
    ? `http://${host.toLowerCase()}` : null;
}

function isSameOriginApp(req: IncomingMessage, origin: string): boolean {
  return req.headers['sec-fetch-site'] === 'same-origin' && req.headers['x-mosa-app'] === '1' &&
    (!req.headers.origin || req.headers.origin === origin);
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length <= limit) chunks.push(chunk);
  }
  if (length > limit) throw new BodyTooLargeError();
  return Buffer.concat(chunks);
}

async function readJson(req: IncomingMessage, limit = 4096): Promise<Record<string, unknown>> {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw new Error('Expected JSON');
  const value = JSON.parse((await readBody(req, limit)).toString('utf8')) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object');
  return value as Record<string, unknown>;
}

function readDestination(value: unknown): ClipDestination | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { projectId, projectName } = value as Partial<ClipDestination>;
  return isClipId(projectId) && typeof projectName === 'string'
    ? { projectId, projectName: projectName.slice(0, 180) } : undefined;
}

function openDesignFile(path: string): Promise<void> {
  const opener = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  return new Promise((resolve, reject) => {
    const child = spawn(opener, [path], { detached: true, stdio: 'ignore', windowsHide: true });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

export function localMosaBridge(): Plugin {
  const configuredToken = process.env.MOSA_CLIPPER_TOKEN;
  const token = configuredToken && /^[A-Za-z0-9_-]{32,128}$/.test(configuredToken)
    ? configuredToken : randomBytes(32).toString('base64url');
  const expectedAuth = Buffer.from(`Bearer ${token}`);
  const workspaces = new Map<string, LocalWorkspace>();

  function getWorkspace(origin: string) {
    let state = workspaces.get(origin);
    if (!state) {
      state = { pending: new Map(), receipts: new Map(), lastAppSeen: 0, lastExtensionSeen: 0, activity: 0, language: 'vi' };
      workspaces.set(origin, state);
    }
    return state;
  }

  async function handleClip(req: IncomingMessage, res: ServerResponse) {
    const origin = loopbackOrigin(req);
    if (!origin) return json(res, 403, { ok: false });
    const route = req.url?.split('?')[0];
    const app = isSameOriginApp(req, origin);
    const requestOrigin = req.headers.origin;
    const extensionOrigin = requestOrigin && /^chrome-extension:\/\/[a-p]{32}$/.test(requestOrigin);
    if (extensionOrigin) {
      res.setHeader('Access-Control-Allow-Origin', requestOrigin);
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS' && extensionOrigin && ['/push', '/receipt', '/health', '/focus'].includes(route || '')) {
      res.writeHead(204, {
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Private-Network': 'true',
      }).end();
      return;
    }
    if (req.method !== 'POST') return json(res, 405, { ok: false });

    // Only the rendered local app can access the pairing code or read the pending queue.
    if (route === '/pair') return app ? json(res, 200, { token }) : json(res, 403, { ok: false });
    if (route === '/app' || route === '/ack') {
      if (!app) return json(res, 403, { ok: false });
      const state = getWorkspace(origin);
      const body = await readJson(req);
      if (route === '/app') {
        const now = Date.now();
        const activity = typeof body.activity === 'number' ? Math.min(now, body.activity) : now;
        if (activity >= state.activity || now - state.lastAppSeen >= ACTIVE_TAB_TTL) {
          state.activity = activity;
          state.lastAppSeen = now;
          state.language = body.language === 'en' ? 'en' : 'vi';
          state.destination = readDestination(body.destination);
        }
        return json(res, 200, {
          paired: now - state.lastExtensionSeen < ACTIVE_TAB_TTL,
          items: Array.from(state.pending.values(), ({ clip, projectId }) => ({ clip, projectId })),
        });
      }
      const receipt = readDestination(body.receipt);
      if (!receipt || !isClipId(body.clipId) || !state.pending.has(body.clipId)) return json(res, 400, { ok: false });
      state.pending.delete(body.clipId);
      state.receipts.set(body.clipId, receipt);
      if (state.receipts.size > 512) {
        const oldest = state.receipts.keys().next().value;
        if (oldest) state.receipts.delete(oldest);
      }
      return json(res, 200, { ok: true });
    }

    // Browsers cannot obtain the code cross-origin. A paired extension presents it on every request.
    const auth = Buffer.from(req.headers.authorization || '');
    if ((requestOrigin && !extensionOrigin) || auth.length !== expectedAuth.length || !timingSafeEqual(auth, expectedAuth)) {
      return json(res, 403, { ok: false });
    }
    const state = getWorkspace(origin);
    state.lastExtensionSeen = Date.now();
    if (route === '/health') {
      const destination = Date.now() - state.lastAppSeen < ACTIVE_TAB_TTL ? state.destination : undefined;
      return json(res, 200, { app: 'Mosa', version: BRIDGE_VERSION, language: state.language, destination });
    }
    if (route === '/focus') {
      const result = await new Promise<object & { ok: boolean }>((resolve) => focusOrLaunchLocalMosaApp(origin, resolve));
      return json(res, result.ok ? 200 : 503, result);
    }
    if (route === '/receipt') {
      const { clipId } = await readJson(req);
      if (!isClipId(clipId)) return json(res, 400, { ok: false });
      const receipt = state.receipts.get(clipId);
      return receipt ? json(res, 200, { status: 'saved', receipt }) : json(res, 202, { status: 'queued' });
    }
    if (route !== '/push') return json(res, 404, { ok: false });

    const body = await readJson(req, MAX_CLIP_BASE64_LENGTH + 32_768);
    const clip = readWebClip(body.clip);
    if (!clip || !isClipId(body.projectId)) return json(res, 400, { ok: false });
    const receipt = state.receipts.get(clip.id);
    if (receipt) return json(res, 200, { status: 'saved', receipt });
    if (!state.pending.has(clip.id)) {
      const size = (clip.imageBase64?.length ?? 0) + 16_384;
      const used = Array.from(state.pending.values()).reduce((total, item) => total + item.size, 0);
      if (state.pending.size >= MAX_QUEUE_ITEMS || used + size > MAX_QUEUE_BYTES) return json(res, 429, { ok: false });
      state.pending.set(clip.id, { clip, projectId: body.projectId, size });
    }
    return json(res, 202, { status: 'queued' });
  }

  async function handleFile(req: IncomingMessage, res: ServerResponse) {
    const origin = loopbackOrigin(req);
    if (!origin || !isSameOriginApp(req, origin)) return json(res, 403, { ok: false });
    if (req.method !== 'POST') return json(res, 405, { ok: false });
    const encoded = req.headers['x-mosa-file-name'];
    const fileName = typeof encoded === 'string' ? nativeDesignFileName(decodeURIComponent(encoded)) : null;
    if (!fileName || req.headers['content-type'] !== 'application/octet-stream') return json(res, 400, { ok: false });
    const bytes = await readBody(req, MAX_NATIVE_FILE_BYTES);
    if (!bytes.length) return json(res, 400, { ok: false });
    const folder = await mkdtemp(join(tmpdir(), 'mosa-file-'));
    const path = join(folder, fileName);
    await writeFile(path, bytes, { flag: 'wx' });
    try {
      await openDesignFile(path);
      return json(res, 200, { ok: true });
    } catch {
      return json(res, 503, { ok: false });
    }
  }

  function attach({ middlewares }: { middlewares: Connect.Server }) {
    const handle = (fn: (req: IncomingMessage, res: ServerResponse) => Promise<void>): Connect.NextHandleFunction =>
      (req, res) => void fn(req, res).catch((error: unknown) => {
        if (!res.headersSent) json(res, error instanceof BodyTooLargeError ? 413 : 400, { ok: false });
      });
    middlewares.use('/__mosa_clip', handle(handleClip));
    middlewares.use('/__local_open_file', handle(handleFile));
  }

  return { name: 'mosa-local-bridge', configureServer: attach, configurePreviewServer: attach };
}
