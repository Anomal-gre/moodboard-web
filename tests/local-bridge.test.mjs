import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { after, test } from 'node:test';
import { createServer as createViteServer } from 'vite';

const vite = await createViteServer({
  configFile: false, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, watch: null, ws: false },
});
after(() => vite.close());
const { localMosaBridge } = await vite.ssrLoadModule('/server/localBridge.ts');
const routes = new Map();
localMosaBridge().configureServer({ middlewares: { use: (path, handler) => routes.set(path, handler) } });

const server = createHttpServer((req, res) => {
  for (const [path, handler] of routes) {
    if (req.url === path || req.url.startsWith(path + '/')) {
      req.url = req.url.slice(path.length) || '/';
      return handler(req, res);
    }
  }
  res.writeHead(404).end();
});
await new Promise((resolve, reject) => {
  server.once('error', reject).listen(0, '127.0.0.1', resolve);
});
after(() => new Promise((resolve) => server.close(resolve)));

const base = 'http://127.0.0.1:' + server.address().port;
const appHeaders = { Origin: base, 'Sec-Fetch-Site': 'same-origin', 'X-Mosa-App': '1' };
const extensionOrigin = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const target = { projectId: 'local_project', projectName: 'Local board' };
const clip = { id: 'test_clip', imageUrl: 'https://example.test/chair.jpg' };
const post = (route, body, headers = {}) => fetch(base + '/__mosa_clip/' + route, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: body === undefined ? undefined : JSON.stringify(body),
});

test('the local relay restricts app and extension routes and confirms clips only after an app receipt', async () => {
  const outside = { Origin: 'https://example.test', 'Sec-Fetch-Site': 'cross-site', 'X-Mosa-App': '1' };
  const unauthorizedPair = await post('pair', {}, outside);
  assert.equal(unauthorizedPair.status, 403);
  assert.notEqual(unauthorizedPair.headers.get('access-control-allow-origin'), '*');
  assert.equal((await post('app', {}, outside)).status, 403);
  assert.equal((await post('push', { clip, projectId: target.projectId }, { Origin: extensionOrigin })).status, 403);
  assert.equal((await fetch(base + '/__mosa_clip/focus')).status, 405);

  const pair = await post('pair', undefined, appHeaders);
  assert.equal(pair.status, 200);
  const { token } = await pair.json();
  const extension = { Origin: extensionOrigin, Authorization: 'Bearer ' + token };
  await post('app', { destination: target, activity: Date.now(), language: 'en' }, appHeaders);
  const health = await post('health', undefined, extension);
  assert.deepEqual((await health.json()).destination, target);

  const pending = await post('push', { clip, projectId: target.projectId }, extension);
  assert.equal(pending.status, 202);
  assert.equal((await post('receipt', { clipId: clip.id }, extension)).status, 202);
  const poll = await post('app', { destination: target, language: 'en' }, appHeaders);
  assert.equal((await poll.json()).items[0].projectId, target.projectId);
  assert.equal((await post('ack', { clipId: clip.id, receipt: target }, appHeaders)).status, 200);
  const acknowledged = await post('receipt', { clipId: clip.id }, extension);
  assert.deepEqual(await acknowledged.json(), { status: 'saved', receipt: target });
  const retry = await post('push', { clip, projectId: target.projectId }, extension);
  assert.deepEqual(await retry.json(), { status: 'saved', receipt: target });
});

test('the native file endpoint requires a local app request with stored design bytes', async () => {
  const send = (headers, body) => fetch(base + '/__local_open_file', { method: 'POST', headers, body });
  const headers = { 'Content-Type': 'application/octet-stream', 'X-Mosa-File-Name': 'sample.dwg' };
  assert.equal((await send(headers, 'fixture')).status, 403);
  assert.equal((await send({ ...headers, ...appHeaders }, '')).status, 400);
  assert.equal((await send({ ...headers, ...appHeaders, 'X-Mosa-File-Name': 'test.html' }, 'fixture')).status, 400);
  assert.equal((await send({ ...appHeaders, 'Content-Type': 'application/json' }, '{"localPath":"sample.dwg"}')).status, 400);
});
