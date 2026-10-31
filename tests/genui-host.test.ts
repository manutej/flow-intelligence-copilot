// TENACITY VERDICT-GENUI-f0f6bdf N1: DNS rebinding could read GET routes (and the CSRF token).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

process.env.GENUI_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'genui-host-'));

const get = (port: number, p: string, host: string) => new Promise<number>((ok, bad) => {
  const req = (http as any).request({ host: '127.0.0.1', port, path: p, method: 'GET', headers: { host } }, (res: any) => { res.resume(); ok(res.statusCode); });
  req.on('error', bad); req.end();
});

test('N1: every GET needs a loopback Host', async () => {
  const { createServer } = await import('../src/genui/server.ts');
  const srv = createServer().listen(0, '127.0.0.1');
  await new Promise<void>((r) => srv.once('listening', () => r()));
  const port = (srv.address() as { port: number }).port;
  try {
    for (const p of ['/', '/api/panels', '/api/action-center', '/fonts/inter.woff2']) {
      for (const h of [`evil.com:${port}`, `localhost.evil.com:${port}`, `127.0.0.1.evil.com:${port}`, 'evil.com']) assert.equal(await get(port, p, h), 403, `${p} ${h}`);
      assert.equal(await get(port, p, `127.0.0.1:${port}`), 200, p);
      assert.equal(await get(port, p, `localhost:${port}`), 200, p);
    }
  } finally { srv.close(); }
});
