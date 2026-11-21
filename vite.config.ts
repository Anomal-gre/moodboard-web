import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

function sanitizeFileName(name: string): string {
  const base = path.basename(name || 'document.bin');
  const cleaned = base.replace(/[<>:"/\\|?*]/g, '_').trim();
  return cleaned || 'document.bin';
}

function openFileWithOS(filePath: string): void {
  if (process.platform === 'win32') {
    const child = spawn('cmd.exe', ['/c', 'start', '', filePath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
  } else if (process.platform === 'darwin') {
    const child = spawn('open', [filePath], { detached: true, stdio: 'ignore' });
    child.unref();
  } else {
    const child = spawn('xdg-open', [filePath], { detached: true, stdio: 'ignore' });
    child.unref();
  }
}

interface QueuedWebClip {
  id: string;
  imageBase64?: string;
  mime?: string;
  fileName?: string;
  imageUrl?: string;
  pageUrl?: string;
  title?: string;
  category?: string;
  note?: string;
  clippedAt: string;
}

const pendingWebClips: QueuedWebClip[] = [];
const MAX_CLIP_QUEUE = 80;
const MAX_CLIP_BODY_BYTES = 35 * 1024 * 1024;
let currentAppLang: 'vi' | 'en' = 'vi';

function attachMosaMiddlewares(middlewares: { use: (path: string, handler: (req: any, res: any) => void) => void }) {
  const setClipCors = (res: any) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  };

  middlewares.use('/__mosa_clip/health', (req, res) => {
    setClipCors(res);
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        ok: true,
        app: 'Mosa',
        lang: currentAppLang,
        pendingCount: pendingWebClips.length,
      })
    );
  });

  middlewares.use('/__mosa_clip/lang', (req, res) => {
    setClipCors(res);
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end('Method Not Allowed');
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as { lang?: string };
        if (body.lang === 'en' || body.lang === 'vi') {
          currentAppLang = body.lang;
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, lang: currentAppLang }));
      } catch {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false }));
      }
    });
  });

  middlewares.use('/__mosa_clip/push', (req, res) => {
    setClipCors(res);
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end('Method Not Allowed');
      return;
    }
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (c: Buffer) => {
      total += c.length;
      if (total <= MAX_CLIP_BODY_BYTES) chunks.push(c);
    });
    req.on('end', () => {
      if (total > MAX_CLIP_BODY_BYTES) {
        res.statusCode = 413;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: false, error: 'Clip exceeds 35 MB limit.' }));
        return;
      }
      try {
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as Partial<QueuedWebClip>;
        if (!payload.imageBase64 && !payload.imageUrl) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: 'Missing imageBase64 or imageUrl.' }));
          return;
        }
        const id =
          typeof payload.id === 'string' && payload.id
            ? payload.id
            : `clip_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        if (!pendingWebClips.some((x) => x.id === id)) {
          pendingWebClips.push({
            id,
            imageBase64: payload.imageBase64,
            mime: payload.mime || 'image/jpeg',
            fileName: sanitizeFileName(payload.fileName || 'web-clip.jpg'),
            imageUrl: payload.imageUrl,
            pageUrl: payload.pageUrl,
            title: (payload.title || '').slice(0, 180),
            category: payload.category,
            note: (payload.note || '').slice(0, 800),
            clippedAt: payload.clippedAt || new Date().toISOString(),
          });
          while (pendingWebClips.length > MAX_CLIP_QUEUE) {
            pendingWebClips.shift();
          }
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, id, pendingCount: pendingWebClips.length }));
      } catch (err) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            ok: false,
            error: err instanceof Error ? err.message : 'Invalid clip JSON.',
          })
        );
      }
    });
  });

  middlewares.use('/__mosa_clip/pending', (req, res) => {
    setClipCors(res);
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, items: pendingWebClips }));
  });

  middlewares.use('/__mosa_clip/ack', (req, res) => {
    setClipCors(res);
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end('Method Not Allowed');
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as { ids?: string[] };
        const idSet = new Set(Array.isArray(body.ids) ? body.ids : []);
        for (let i = pendingWebClips.length - 1; i >= 0; i--) {
          if (idSet.has(pendingWebClips[i].id)) {
            pendingWebClips.splice(i, 1);
          }
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, remaining: pendingWebClips.length }));
      } catch {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false }));
      }
    });
  });

  middlewares.use('/__local_open_file', (req, res) => {
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end('Method Not Allowed');
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        const payload = JSON.parse(raw) as {
          fileName?: string;
          localPath?: string;
          base64?: string;
        };

        if (payload.localPath && fs.existsSync(payload.localPath)) {
          openFileWithOS(payload.localPath);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, openedPath: payload.localPath }));
          return;
        }

        if (payload.base64) {
          const safeName = sanitizeFileName(payload.fileName || 'document.bin');
          const cacheDir = path.join(os.tmpdir(), 'mosa_moodboard_files');
          fs.mkdirSync(cacheDir, { recursive: true });
          const targetPath = path.join(cacheDir, safeName);
          fs.writeFileSync(targetPath, Buffer.from(payload.base64, 'base64'));
          openFileWithOS(targetPath);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, openedPath: targetPath }));
          return;
        }

        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: false, error: 'Thiếu dữ liệu tệp.' }));
      } catch (err) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            ok: false,
            error: err instanceof Error ? err.message : 'Lỗi mở tệp cục bộ.',
          })
        );
      }
    });
  });
}

function localNativeBridgePlugin(): Plugin {
  return {
    name: 'mosa-local-native-bridge',
    configureServer(server) {
      attachMosaMiddlewares(server.middlewares);
    },
    configurePreviewServer(server) {
      attachMosaMiddlewares(server.middlewares);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), localNativeBridgePlugin()],
  server: {
    host: '127.0.0.1',
    port: 4313,
    strictPort: false,
  },
  preview: {
    host: '127.0.0.1',
    port: 4313,
    strictPort: false,
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/') || id.includes('node_modules/scheduler/')) {
            return 'vendor-react';
          }
          if (id.includes('node_modules/lucide-react/')) {
            return 'vendor-icons';
          }
        },
      },
    },
  },
});
