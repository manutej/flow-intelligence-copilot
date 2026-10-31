import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleMcpHttpRequest } from '../src/mcp/http.ts';

// find_properties with includeOnboarding returns public fields only.
test('find_properties returns id, name, neighborhood, class and status only', async () => {
  const res = await handleMcpHttpRequest({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'find_properties', arguments: { includeOnboarding: true } } }),
  });
  const data = JSON.parse(res.body).result.structuredContent.data as { matched: Array<Record<string, unknown>> };
  assert.ok(data.matched.some((p) => p.status === 'onboarding'));
  for (const p of data.matched) assert.deepEqual(Object.keys(p).sort(), ['buildingClass', 'name', 'neighborhood', 'propertyId', 'status']);
  assert.doesNotMatch(res.body, /"aka"|blockingReasons|onboardingReadiness|"address"|withheld/);
});
