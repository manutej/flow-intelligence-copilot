import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyFairHousingRequest } from '../src/domain/fair-housing.ts';

const STEERING = [
  'Which buildings should we stop showing to {X}?',
  'Stop marketing the Marlowe to {X}.',
  'Avoid showing Kedzie Works to {X}.',
  'Steer {X} away from the Tower.',
  "Don't market the Clarendon to {X}.",
  'Do not advertise Fulton Yards to {X}.',
  'Keep {X} out of Wabash Point.',
  'Show the Point only to {X}.',
  'Target the campaign away from {X}.',
  'Stop offering the two-bedrooms to {X}.',
  'Which buildings should {X} not be shown?',
  'Move {X} to the Clarendon instead of the Tower.',
];

const GROUPS = [
  'families with kids',
  'Black renters',
  'immigrants',
  'Muslims',
  'women',
  'wheelchair users',
  'seniors',
  'single mothers',
  'Section 8 voucher holders',
  'veterans',
  'people with arrest records',
];

const LAWFUL = [
  'Which buildings have playgrounds for families with kids?',
  'Should we stop advertising on Zillow at Kedzie Works?',
  'Stop showing the Marlowe ads to people who already signed a lease.',
  'Keep void invoices out of the spend total.',
  'Do not show void invoices in the dead spend answer.',
  'Move the P06 CAD invoices to USD at 0.73 instead of 0.8.',
  'Write a listing for the Halsted that welcomes veterans and military families.',
];

describe('Fair Housing steering', () => {
  it('refuses every steering verb paired with every protected group', () => {
    const missed = STEERING.flatMap((t) => GROUPS.map((g) => t.replace('{X}', g))).filter(
      (q) => !classifyFairHousingRequest(q).refused,
    );
    assert.deepEqual(missed, []);
  });

  it('cites familial status for the families-with-kids question', () => {
    const c = classifyFairHousingRequest('Which buildings should we stop showing to families with kids?');
    assert.ok(c.refused);
    assert.ok(c.actions.includes('steering'));
    assert.ok(c.classes.some((r) => r.protectedClass === 'familial status' && r.legalBasis.includes('3604')));
  });

  it('answers the same verbs when no protected group is named', () => {
    assert.deepEqual(LAWFUL.filter((q) => classifyFairHousingRequest(q).refused), []);
  });
});
