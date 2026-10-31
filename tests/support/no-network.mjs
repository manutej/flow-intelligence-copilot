// Loaded before every test file (npm test: --import). Tests never touch the network: fetch,
// http(s), net/tls sockets and DNS to anything but this machine's own test servers (loopback)
// throw, so a test that forgets a fake rate provider fails closed instead of calling a live API.
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';

// The suite runs local test servers; with loopback down (plain `unshare -rn`) they would hang, so
// say so at once instead.
if (!Object.values(os.networkInterfaces()).flat().some((a) => a?.internal && a.address === '127.0.0.1'))
  throw new Error('tests need the loopback interface (127.0.0.1), which is down; with unshare -rn run `ip link set lo up` first');

const LOOPBACK = /^(?:localhost|127(?:\.\d{1,3}){3}|::1|\[::1\])$/;
const blocked = (what, host) => {
  throw new Error(`network is disabled in tests (${what} ${String(host)}); inject a fake, e.g. setRateProvider()`);
};
const hostOf = (a) => {
  if (typeof a === 'string') { try { return new URL(a).hostname; } catch { return a; } }
  if (a instanceof URL) return a.hostname;
  if (a && typeof a === 'object') { return a.hostname ?? a.host ?? 'localhost'; }
  return 'localhost';
};
const guard = (what, f, pick) => (...args) => { const h = pick(args).replace(/:\d+$/, ''); return LOOPBACK.test(h) ? f(...args) : blocked(what, h); };

const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (LOOPBACK.test(url.hostname)) return realFetch(input, init);
  return blocked('fetch', url.href);
};
for (const [name, mod] of [['http', http], ['https', https]]) {
  mod.request = guard(`${name}.request`, mod.request, (a) => hostOf(a[0]));
  mod.get = guard(`${name}.get`, mod.get, (a) => hostOf(a[0]));
}
// net.connect(port, host) / net.connect({ host, port }) / a unix socket path
const sockHost = (a) => typeof a[0] === 'object' && a[0] !== null ? hostOf(a[0]) : typeof a[0] === 'string' && !/^\d+$/.test(a[0]) ? 'localhost' : typeof a[1] === 'string' ? a[1] : 'localhost';
net.connect = guard('net.connect', net.connect, sockHost);
net.createConnection = guard('net.createConnection', net.createConnection, sockHost);
tls.connect = guard('tls.connect', tls.connect, sockHost);
for (const k of ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny'])
  dns[k] = guard(`dns.${k}`, dns[k], (a) => String(a[0]));
dns.promises.lookup = guard('dns.promises.lookup', dns.promises.lookup, (a) => String(a[0]));
dns.promises.resolve = guard('dns.promises.resolve', dns.promises.resolve, (a) => String(a[0]));
syncBuiltinESMExports();
