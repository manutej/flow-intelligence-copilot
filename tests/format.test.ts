import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fmtUsd, plural, unwrapLines, wrapLines } from '../src/domain/format.ts';

describe('format helpers never change the data they print', () => {
  it('formats dollars with separators and keeps the digits', () => {
    assert.equal(fmtUsd(84560), '$84,560.00');
    assert.equal(fmtUsd(199880, { trimCents: true }), '$199,880');
    assert.equal(fmtUsd(2212.66), '$2,212.66');
    assert.equal(fmtUsd(-250), '-$250.00');
  });

  it('pluralises by count', () => {
    assert.equal(plural(1, 'signed lease'), '1 signed lease');
    assert.equal(plural(2, 'signed lease'), '2 signed leases');
    assert.equal(plural(0, 'tour'), '0 tours');
  });

  it('wraps compact JSON and money without inserting characters', () => {
    const samples = [
      'Moving $84,560.00 / 29 leases buys 15 more leases at $2,915.86 each.',
      JSON.stringify({ property_id: 'P02', usd: 199880, citations: ['leases:L00271', 'leases:L00272'] }),
      `{"id":"B01","result":{"property_id":"P02","usd":199880}} ${'x'.repeat(130)}`,
    ];
    for (const text of samples) {
      for (const width of [12, 24, 40, 72]) {
        const lines = wrapLines(text, width);
        assert.equal(unwrapLines(lines), text, `width ${width}`);
        for (const l of lines) assert.ok(l.text.length <= Math.max(8, width));
      }
    }
  });
});
