import assert from 'node:assert/strict';
import { load } from './load.mjs';
// The one rewarded door per completion, the first-variant guarantee and the variant perks –
// all pure data rules; no canvas, no SDK.
const { pickOffer, seekCandidates, seekPick, setProgress, OfferStats } = await load('ads/Offers');
const { PadProgress, DiscoveryProvider } = await load('pads/progress');
const { PADS, VARIANTS, applyVariant } = await load('pads/PadTypes');
const { FIRST_VARIANT_PAD, VARIANT_PERKS, hiddenWeight, NONE, HIDDEN_POOLS } = await load('rewards/rates');
const { HIDDEN_TYPES, ULTRA_TYPES, RARITY_WEIGHT } = await load('beads/BeadTypes');

// ── which door ───────────────────────────────────────────────────────────
const base = { hadTreasure: true, bonus: false, nextBase: 'cloud', found: () => false, totalCompleted: 2, rand: () => 0 };
assert.equal(pickOffer({ ...base, nextTier: 'rare' }).kind, 'rare', 'a passing variant always wins');
assert.equal(pickOffer({ ...base, nextTier: 'super' }).kind, 'rare');
assert.equal(pickOffer({ ...base, hadTreasure: false }).kind, 'dig', 'an empty pad offers the dig');
assert.equal(pickOffer({ ...base, hadTreasure: false, bonus: true }).kind, 'choose', 'no dig after a dig');
assert.equal(pickOffer({ ...base, totalCompleted: 2 }).kind, 'choose');
const seek = pickOffer({ ...base, totalCompleted: 3 });
assert.equal(seek.kind, 'seek');
assert.ok(HIDDEN_POOLS.cloud.some((e) => e.id === seek.seekId), 'seek prefers a treasure of the next pad');
assert.ok(seek.title.includes(seek.seekName));
assert.equal(pickOffer({ ...base, totalCompleted: 3, found: () => true }).kind, 'choose', 'nothing missing → choose');

// The door says what it gives: the pin first, else the treasure that finishes a set.
const pinnedSeek = pickOffer({ ...base, totalCompleted: 2, pinned: 'gummybear' });
assert.equal(pinnedSeek.kind, 'seek', 'a pin always gets its door, even on an even pad');
assert.equal(pinnedSeek.seekId, 'gummybear');
assert.ok(pinnedSeek.title.startsWith('📍') && pinnedSeek.pinned);
const cozyFound = (id) => ['cloudcharm', 'pawcharm', 'ribboncharm'].includes(id);
const finishing = pickOffer({ ...base, totalCompleted: 3, found: cozyFound });
assert.equal(finishing.seekId, 'gummybear', 'the treasure that completes a set comes first');
assert.equal(finishing.sub, '포근 세트 완성!');
const halfSea = (id) => id === 'smallshell';
const seaSeek = pickOffer({ ...base, totalCompleted: 3, found: halfSea, nextBase: 'shell' });
assert.match(seaSeek.sub, /^바다 세트 1\/3 → 2\/3$/);
assert.deepEqual(setProgress('gummybear', cozyFound), { name: '포근', have: 3, total: 4 });
assert.equal(seekPick({ nextBase: 'cloud', found: () => true }), undefined);
assert.equal(seekPick({ nextBase: 'cloud', found: () => false, pinned: 'crown' })?.id !== 'crown', true, 'an ultra pin is not plantable');
// a plant ticket: the seek door is free and always offered (after a variant or a dig)
const ticket = pickOffer({ ...base, totalCompleted: 2, tickets: 1 });
assert.equal(ticket.kind, 'seek');
assert.ok(ticket.free && ticket.title.includes('심기권으로'));
assert.equal(pickOffer({ ...base, nextTier: 'rare', tickets: 1 }).kind, 'rare');
// the dig names its sure treasure before the ad – a silhouette while it is new
const dig = pickOffer({ ...base, hadTreasure: false, dig: { id: 'key', name: '열쇠' } });
assert.deepEqual([dig.kind, dig.digId, dig.digNew, dig.sub], ['dig', 'key', true, '처음 보는 보물 하나 확정']);
const digAgain = pickOffer({ ...base, hadTreasure: false, found: (id) => id === 'key', dig: { id: 'key', name: '열쇠' } });
assert.deepEqual([digAgain.digNew, digAgain.sub], [false, '열쇠 하나 확정']);
assert.equal(pickOffer({ ...base, hadTreasure: false }).sub, '보물 하나 묻힌 작은 패드');
assert.ok(seekCandidates('cloud', () => false).every((t) => !ULTRA_TYPES.includes(t)), 'ultras are never planted');
const notInPool = seekCandidates('cloud', (id) => HIDDEN_POOLS.cloud.some((e) => e.id === id));
assert.ok(notInPool.length > 0 && notInPool.every((t) => HIDDEN_TYPES.includes(t)), 'falls back to any missing treasure');

// ── counters ─────────────────────────────────────────────────────────────
const data = new Map();
const storage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
const stats = new OfferStats(storage);
stats.note('offered', 'dig'); stats.note('offered', 'dig'); stats.note('taken', 'dig');
assert.deepEqual(new OfferStats(storage).snapshot.offered, { dig: 2 });
assert.equal(new OfferStats(storage).snapshot.taken.dig, 1);
const broken = { getItem: () => { throw Error('private'); }, setItem: () => { throw Error('private'); } };
new OfferStats(broken).note('earned', 'peek');

// ── the 4th pad is a rare variant for a player who never met one ─────────
const prog = new PadProgress();
const provider = new DiscoveryProvider(() => 0.99); // the ordinary roll never produces a variant
assert.equal(prog.padIndex, 1);
assert.equal(provider.next(prog).tier, undefined, 'pad 2 is plain');
prog.complete();                                           // pad 1 done
assert.equal(prog.padIndex, 1);
prog.open(provider.next(prog)); prog.complete();           // pad 2 done
assert.equal(prog.padIndex, 2);
prog.open(provider.next(prog));                            // pad 3 on the table
assert.equal(prog.padIndex, 3);
const fourth = provider.next(prog);
assert.equal(fourth.tier, 'rare', `pad ${FIRST_VARIANT_PAD} is forced rare in FIRST_DISCOVERY`);
assert.ok(fourth.variantOf && !prog.isDiscovered(fourth.variantOf), 'still the next undiscovered base pad');
prog.complete();
assert.equal(provider.next(prog).tier, 'rare', 'same answer whether rolled before or after the last POP');
// let it pass: open the plain base
const plain = PADS.find((p) => p.id === fourth.variantOf);
prog.open(plain); prog.complete();
assert.equal(provider.next(prog).tier, undefined, 'letting it pass does not force the 5th');
const seen = new PadProgress();
seen.open(applyVariant(PADS[0], VARIANTS.cloud[0])); seen.complete();
seen.open(PADS[1]); seen.complete(); seen.open(PADS[2]);
assert.equal(seen.padIndex, 3);
assert.equal(provider.next(seen).tier, undefined, 'a player who has met a variant is not forced');

// ── choices: the next pad plus two distinct others ───────────────────────
const choices = provider.choices(prog, provider.next(prog), 2);
assert.equal(choices.length, 3);
assert.equal(new Set(choices.map((p) => p.variantOf ?? p.id)).size, 3);

// ── what a caught variant is worth ───────────────────────────────────────
for (const [baseId, vs] of Object.entries(VARIANTS)) {
  const b = PADS.find((p) => p.id === baseId);
  for (const v of vs) {
    const pad = applyVariant(b, v);
    const perk = VARIANT_PERKS[v.tier];
    assert.ok(pad.beads.raritySkew.rare >= perk.rareSkew, `${pad.id} rare skew`);
    assert.equal(pad.beads.rareCenterChance, perk.rareCenterChance, `${pad.id} centre rare`);
    assert.ok(pad.beads.kingChance >= perk.kingChance, `${pad.id} king`);
  }
}
assert.ok(VARIANTS.flower.some((v) => applyVariant(PADS[1], v).beads.raritySkew.rare >= 2.2), 'a variant with its own skew keeps it');
assert.ok(RARITY_WEIGHT.rare * VARIANT_PERKS.rare.rareSkew > 1.15, 'a rare pad has more rares than the old ordinary pad');
const ultraIds = ULTRA_TYPES.map((t) => t.id);
const none = { id: NONE, w: 38 }, thing = { id: 'key', w: 8 }, ultra = { id: 'crown', w: 1 };
assert.equal(hiddenWeight(none, { ultraIds }), 38);
assert.equal(hiddenWeight(none, { dayBonus: true, ultraIds }), 19);
assert.equal(hiddenWeight(none, { guarantee: true, ultraIds }), 0, 'rare variant / first pads / dig: never empty');
assert.equal(hiddenWeight(thing, { guarantee: true, ultraIds }), 8);
assert.equal(hiddenWeight(thing, { ultraOnly: true, ultraIds }), 0, 'super variant: ultra only');
assert.equal(hiddenWeight(ultra, { ultraOnly: true, ultraIds }), 1);
assert.ok(Object.values(HIDDEN_POOLS).every((pool) => pool.some((e) => ultraIds.includes(e.id))), 'every pool has an ultra to give');

console.log('PASS: one door per completion (rare > dig > seek/choose), counters, forced 4th-pad variant, choices, variant perks, hidden weights');
