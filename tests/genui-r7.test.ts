// VERDICT-GENUI-d6406ed T3: the offline preload covers raw sockets, UDP and every DNS entry point.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const load = (m: string): Promise<any> => import(m);

test('LOW: new net.Socket().connect is blocked off loopback, allowed on it', async () => {
  const net = await load('node:net');
  assert.throws(() => new net.Socket().connect(443, 'example.com'), /network is disabled/);
  assert.throws(() => new net.Socket().connect({ host: '93.184.216.34', port: 80 }), /network is disabled/);
  const server = net.createServer((s: any) => s.end());
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const sock = new net.Socket();
  await new Promise<void>((r, j) => { sock.once('error', j); sock.connect(server.address().port, '127.0.0.1', () => r()); });
  sock.destroy(); server.close();
});

test('LOW: dns/promises, dns.Resolver and dgram are blocked', async () => {
  const dns = await load('node:dns');
  const dnsp = await load('node:dns/promises');
  const dgram = await load('node:dgram');
  assert.throws(() => dnsp.resolve4('example.com'), /network is disabled/);
  assert.throws(() => dnsp.resolveMx('example.com'), /network is disabled/);
  assert.throws(() => new dns.Resolver().resolve4('example.com', () => {}), /network is disabled/);
  assert.throws(() => new dnsp.Resolver().resolve6('example.com'), /network is disabled/);
  const udp = dgram.createSocket('udp4');
  assert.throws(() => udp.send(Buffer.from('x'), 53, '8.8.8.8'), /network is disabled/);
  udp.close();
});
