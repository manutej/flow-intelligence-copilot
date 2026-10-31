// Loaded before every test file (npm test: --import). Tests never touch the network: fetch,
// http(s), net/tls sockets (new net.Socket().connect too), UDP (dgram) and DNS (callback,
// promises and Resolver) to anything but this machine's own test servers (loopback)
// throw, so a test that forgets a fake rate provider fails closed instead of calling a live API.
import dgram from 'node:dgram';
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
// every socket connects through Socket.prototype.connect, net.connect wraps its arguments in an array
const realSockConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const a = Array.isArray(args[0]) ? args[0] : args;
  const h = sockHost(a).replace(/:\d+$/, '');
  return LOOPBACK.test(h) || (a[0] && typeof a[0] === 'object' && a[0].path) ? realSockConnect.apply(this, args) : blocked('net.Socket.connect', h);
};
// dgram: send(msg, [offset, length,] port, [address], cb) and connect(port, [address], cb)
const udpHost = (a) => a.find((x, i) => i > 0 && typeof x === 'string') ?? 'localhost';
for (const k of ['send', 'connect']) {
  const real = dgram.Socket.prototype[k];
  dgram.Socket.prototype[k] = function (...args) { const h = udpHost(k === 'connect' ? [null, ...args] : args); return LOOPBACK.test(h) ? real.apply(this, args) : blocked(`dgram.${k}`, h); };
}
// DNS: every lookup and resolve*, on the module, dns.promises and both Resolver classes
const dnsKeys = (o) => Object.getOwnPropertyNames(o).filter((k) => /^(?:lookup|resolve|reverse)/.test(k) && typeof o[k] === 'function');
for (const [label, o] of [['dns', dns], ['dns.promises', dns.promises]])
  for (const k of dnsKeys(o)) o[k] = guard(`${label}.${k}`, o[k], (a) => String(a[0]));
for (const [label, R] of [['dns.Resolver', dns.Resolver], ['dns.promises.Resolver', dns.promises.Resolver]])
  for (const k of dnsKeys(R.prototype)) {
    const real = R.prototype[k];
    R.prototype[k] = function (...args) { const h = String(args[0]); return LOOPBACK.test(h) ? real.apply(this, args) : blocked(`${label}.${k}`, h); };
  }
syncBuiltinESMExports();
