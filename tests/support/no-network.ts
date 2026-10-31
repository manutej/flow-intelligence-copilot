// Loaded before every test file (npm test: --import). Tests never touch the network: a fetch to
// anything but this machine's own test servers (loopback) throws, so a test that forgets a fake
// rate provider fails closed instead of calling a live API.
const realFetch = globalThis.fetch;
const LOOPBACK = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])$/;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (LOOPBACK.test(url.hostname)) return realFetch(input, init);
  throw new Error(`network is disabled in tests (fetch ${url.href}); inject a fake, e.g. setRateProvider()`);
}) as typeof fetch;
