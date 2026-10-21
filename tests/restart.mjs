import assert from 'node:assert/strict';
import { load } from './load.mjs';
// What a restart must keep: the treasure under the pad on the table, an ad reward already
// earned (variant caught, bonus dig), and the day turning while the game stays open.
const data = new Map();
globalThis.localStorage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) };
const { PadProgress } = await load('pads/progress');
const { PADS, VARIANTS, applyVariant } = await load('pads/PadTypes');
const restart = () => new PadProgress();

// The buried treasure of the pad on the table survives a restart; a new pad forgets it.
let p = restart();
p.open(PADS[0]);
assert.equal(p.currentHidden, undefined, 'a fresh pad has not buried anything yet');
p.setCurrentHidden('cloudcharm');
assert.equal(restart().currentHidden, 'cloudcharm');
p = restart();
p.setCurrentHidden(null);
assert.equal(restart().currentHidden, null, '"nothing buried" is kept too – no re-roll by restarting');
p = restart();
p.open(PADS[1]);
assert.equal(restart().currentHidden, undefined);

// A caught variant: only with a rolled next pad, kept across a restart, dropped when the next pad changes or opens.
const base = PADS.find((pad) => VARIANTS[pad.id]?.length);
const variant = applyVariant(base, VARIANTS[base.id][0]);
p = restart();
p.catchNext();
assert.equal(restart().nextCaught, false, 'nothing to catch without a rolled next pad');
p.complete();
p.setNext(variant, 'bigglass');
p.catchNext();
assert.equal(restart().nextCaught, true);
p = restart();
p.setNext(variant, 'key'); // same pad, re-rolled treasure: still caught
assert.equal(restart().nextCaught, true);
p.setNext(PADS[2], null);
assert.equal(restart().nextCaught, false, 'another next pad is not the caught one');
p.setNext(variant, null);
p.catchNext();
p.open(variant);
assert.equal(restart().nextCaught, false, 'opening it uses the catch up');

// A bonus dig paid for: its treasure is kept until dug up (or until a new pad opens).
p = restart();
p.complete();
p.setBonusTreasure('key');
assert.equal(restart().bonusTreasure, 'key', 'a restart digs the same treasure, never a re-roll');
p = restart();
p.setBonusTreasure(null); // dug up
assert.equal(restart().bonusTreasure, null, 'once found it is not buried again');
p.setBonusTreasure('eye');
p.open(PADS[3]);
assert.equal(restart().bonusTreasure, null);

// A gel of the day remembers its date, so a restart mid-pad rebuilds it (shape and colour).
{
  const { dailyPad } = await load('rewards/daily');
  const gel = dailyPad('2026-10-21');
  p = restart();
  p.open(gel);
  assert.equal(restart().currentDaily, '2026-10-21');
  assert.equal(restart().current.id, gel.id);
  p.open(PADS[2]);
  assert.equal(restart().currentDaily, '', 'an ordinary pad is not a gel of the day');
}

// Junk in the new fields is repaired, not trusted.
const saved = JSON.parse(data.get('ssok.progress.v2'));
data.set('ssok.progress.v2', JSON.stringify({ ...saved, currentHidden: 5, nextCaught: 'yes', bonusTreasure: 7, nextId: null }));
p = restart();
assert.equal(p.currentHidden, undefined);
assert.equal(p.nextCaught, false);
assert.equal(p.bonusTreasure, null);

// Midnight with the game open: the day turns once, and the next pad gets the new-day nudge.
p = restart();
assert.equal(p.rollDay(), false, 'same day');
p.takeDayBonus();
p['s'].lastPlayDate = '2000-01-01'; // this instance started before midnight
assert.equal(p.rollDay(), true, 'past midnight');
assert.equal(p.takeDayBonus(), true, 'the next pad gets the nudge');
assert.equal(p.rollDay(), false, 'only once');
assert.equal(p.takeDayBonus(), false);
assert.notEqual(JSON.parse(data.get('ssok.progress.v2')).lastPlayDate, '2000-01-01', 'the new day is saved');
console.log('PASS: buried treasure kept across a mid-pad restart / caught variant + paid bonus treasure survive a restart, never re-rolled / junk repaired / midnight rolls the day once');
