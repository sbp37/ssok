import assert from 'node:assert/strict';
import { load } from './load.mjs';
// "자석 싹쓸이": when it is offered, and the order and beat it takes the last beads in.
const { magnetAllowed, magnetOrder, MAGNET_LEFT, MAGNET_CHARGE, MAGNET_GAP, MAGNET_RISE } = await load('pads/magnet');
const { FREE_PADS } = await load('ads/AdPolicy');

// Offered on a real pad past the ad-free opening pads, for the last six beads.
assert.equal(MAGNET_LEFT, 6);
assert.equal(magnetAllowed({ left: 6, completed: FREE_PADS, bonus: false }), true);
assert.equal(magnetAllowed({ left: 1, completed: 40, bonus: false }), true, 'down to the very last (hard) bead');
assert.equal(magnetAllowed({ left: 7, completed: 40, bonus: false }), false, 'only the last few beads');
assert.equal(magnetAllowed({ left: 0, completed: 40, bonus: false }), false, 'an emptied pad has nothing left to take');
assert.equal(magnetAllowed({ left: 3, completed: FREE_PADS - 1, bonus: false }), false, 'never on the ad-free opening pads');
assert.equal(magnetAllowed({ left: 3, completed: 40, bonus: true }), false, 'never in a bonus dig (a handful of beads already)');

// Order: beads on top first, nearest the jar first; a bead under another waits for its hole.
const bead = (id, layer, slot, d) => ({ id, layer, slot, d });
const left = [bead('far-top', 0, 1, 50), bead('under-far', 1, 1, 10), bead('near-top', 0, 2, 20), bead('open-deep', 1, 3, 30)];
const order = magnetOrder(left, (b) => b.d);
assert.deepEqual(order.map((o) => o.bead.id), ['near-top', 'open-deep', 'far-top', 'under-far'],
  'a deep bead whose top bead is gone already counts as a top bead');
assert.equal(order[0].at, MAGNET_CHARGE, 'a beat of charge before the first bead lets go');
assert.ok(order.every((o, i) => i === 0 || o.at >= order[i - 1].at + MAGNET_GAP - 1e-9), 'one at a time');
const top = order.find((o) => o.bead.id === 'far-top'), under = order.find((o) => o.bead.id === 'under-far');
assert.ok(under.at >= top.at + MAGNET_RISE, 'the bead under it waits until it has begun to rise');
assert.equal(new Set(order.map((o) => o.bead)).size, left.length, 'every bead exactly once');

// The whole sweep stays short: six beads, half of them under the others.
const six = Array.from({ length: 6 }, (_, i) => bead(i, i < 3 ? 0 : 1, i % 3, i));
const sweep = magnetOrder(six, (b) => b.d);
assert.ok(sweep.at(-1).at < 2, `six beads in under two seconds (${sweep.at(-1).at.toFixed(2)}s)`);
assert.deepEqual(magnetOrder([], () => 0), []);
console.log('PASS: magnet offered for the last 6 beads of a real pad past the opening / tops nearest the jar first / covered beads after their hole / one at a time / short');
