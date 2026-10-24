import assert from 'node:assert/strict';
import { load } from './load.mjs';
// Today's gel, the stamp card and plant tickets – in-game only, never points.
const { DailyStore, dailyPad, dayBefore, CARD_SIZE, STREAK_GOAL, RAINBOW_BASE } = await load('rewards/daily');
const { rainbowPool, NONE } = await load('rewards/rates');
const { PADS } = await load('pads/PadTypes');
const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
const day = (n) => `2026-11-${String(n).padStart(2, '0')}`;

// Stamps: one a day, a missed day costs nothing, seven make a ticket and a new card.
let mem = memory();
let d = new DailyStore(day(1), false, mem);
assert.deepEqual(d.stamp(day(1)), { stamped: true, n: 1, full: false });
assert.deepEqual(d.stamp(day(1)), { stamped: false, n: 1, full: false }, 'one stamp a day');
d.stamp(day(3)); // skipped day 2: nothing lost
assert.equal(d.stamps, 2);
for (const n of [4, 5, 6, 7]) d.stamp(day(n));
assert.equal(d.stamps, 6);
assert.deepEqual(d.stamp(day(9)), { stamped: true, n: CARD_SIZE, full: true });
assert.equal(d.stamps, 0, 'a fresh card');
assert.equal(d.cards, 1);
assert.equal(d.tickets, 1);
// kept across restarts
d = new DailyStore(day(9), false, mem);
assert.equal(d.tickets, 1);
assert.equal(d.stampedOn(day(9)), true);
// Tickets: spent one at a time.
assert.equal(d.useTicket(), true);
assert.equal(d.useTicket(), false);
// A share pays one ticket a day.
assert.equal(d.shared(day(10)), true);
assert.equal(d.shared(day(10)), false);
assert.equal(d.shared(day(11)), true);
assert.equal(d.tickets, 2);

// Today's gel: due once a day, never on a new player's first day.
mem = memory();
const fresh = new DailyStore(day(1), true, mem);
assert.equal(fresh.dailyDue(day(1)), false, 'a new player meets the gel of the day tomorrow');
assert.equal(fresh.dailyDue(day(2)), true);
fresh.openedDaily(day(2));
assert.equal(new DailyStore(day(2), false, mem).dailyDue(day(2)), false, 'once a day, across restarts');
assert.equal(fresh.dailyDue(day(3)), true);
const returning = new DailyStore(day(5), false, memory());
assert.equal(returning.dailyDue(day(5)), true, 'a player from before this version gets it today');

// Junk is repaired.
const junk = memory();
junk.setItem('ssok.daily.v1', JSON.stringify({ stamps: 99, cards: -2, tickets: 'x', stampDay: 5, firstDay: null }));
const j = new DailyStore(day(1), true, junk);
assert.equal(j.stamps, CARD_SIZE - 1);
assert.equal(j.cards, 0);
assert.equal(j.tickets, 0);
assert.equal(j.dailyDue(day(1)), true);
const broken = { getItem: () => { throw Error('private'); }, setItem: () => { throw Error('private'); } };
assert.doesNotThrow(() => new DailyStore(day(1), true, broken).stamp(day(1)));

// The pad of the day: the same pad and colour for everyone on a date, different across days.
const a = dailyPad(day(21)), b = dailyPad(day(21));
assert.equal(a.id, b.id);
assert.deepEqual(a.gelColor, b.gelColor);
assert.ok(a.daily && a.tinted && PADS.some((p) => p.id === a.id) && !a.variantOf);
const month = Array.from({ length: 30 }, (_, i) => dailyPad(`2026-12-${String(i + 1).padStart(2, '0')}`));
assert.ok(new Set(month.map((p) => p.id)).size >= 6, 'a month of days shows many pads');
assert.ok(new Set(month.map((p) => JSON.stringify(p.gelColor))).size >= 8, 'and many colours');
// Attendance streak: days in a row with a visit; every third day in a row, the gel of the day is a rainbow gel.
assert.equal(STREAK_GOAL, 3);
assert.equal(dayBefore('2026-11-01'), '2026-10-31');
assert.equal(dayBefore('2027-01-01'), '2026-12-31');
assert.equal(dayBefore('2028-03-01'), '2028-02-29', 'leap day');
mem = memory();
let st = new DailyStore(day(1), true, mem);
assert.equal(st.streak, 0);
assert.deepEqual(st.visit(day(1)), { streak: 1, first: true });
assert.deepEqual(st.visit(day(1)), { streak: 1, first: false }, 'one visit a day');
assert.deepEqual(st.visit(day(2)), { streak: 2, first: true });
assert.equal(st.rainbowOn(day(2)), false);
st = new DailyStore(day(3), false, mem);
assert.equal(st.streak, 2, 'kept across restarts');
assert.deepEqual(st.visit(day(3)), { streak: 3, first: true });
assert.equal(st.rainbowOn(day(3)), true, 'the third day in a row: a rainbow gel');
assert.equal(new DailyStore(day(3), false, mem).rainbowOn(day(3)), true, 'a restart on that day keeps it');
st.visit(day(4));
st.visit(day(5));
assert.equal(st.rainbowOn(day(4)) || st.rainbowOn(day(5)), false);
assert.equal(st.visit(day(6)).streak, 6);
assert.equal(st.rainbowOn(day(6)), true, 'every third day in a row');
assert.equal(st.visit(day(8)).streak, 1, 'a missed day starts the count again');
assert.equal(st.rainbowOn(day(8)), false);
st = new DailyStore('2026-12-30', false, memory());
st.visit('2026-12-30');
st.visit('2026-12-31');
assert.equal(st.visit('2027-01-01').streak, 3, 'across a month and a year');
assert.equal(st.rainbowOn('2027-01-01'), true);
const junkStreak = memory();
junkStreak.setItem('ssok.daily.v1', JSON.stringify({ streak: -4, visitDay: 7, rainbowDay: [] }));
st = new DailyStore(day(1), false, junkStreak);
assert.equal(st.streak, 0);
assert.equal(st.visit(day(1)).streak, 1);

// The rainbow gel: the same pad of the day, in rainbow silicone – and a treasure never found before.
const plain = dailyPad(day(21)), rainbow = dailyPad(day(21), true);
assert.equal(rainbow.id, plain.id);
assert.equal(rainbow.daily, day(21));
assert.equal(rainbow.rainbow, true);
assert.deepEqual(rainbow.gelColor, RAINBOW_BASE);
assert.equal(plain.rainbow, undefined);
const pool = [{ id: NONE, w: 30 }, { id: 'a', w: 50 }, { id: 'b', w: 10 }, { id: 'ultra', w: 1 }];
assert.deepEqual(rainbowPool(pool, (id) => id === 'a', ['ultra']).map((e) => e.id), ['b'], 'only what is still missing, never "nothing"');
assert.deepEqual(rainbowPool(pool, (id) => id !== 'ultra', ['ultra']), pool, 'all found (an ultra stays legendary): the usual pool');
console.log('PASS: stamp a day / missed days free / 7 → ticket + new card / tickets / share ticket once a day / gel of the day once a day, not on day one / same pad for everyone / junk repaired / streak of days in a row, rainbow gel every third day, new treasure first');
