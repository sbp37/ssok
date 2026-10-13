import assert from 'node:assert/strict';
import { load } from './load.mjs';
// The one rewarded door per completion, the first-variant guarantee and the variant perks –
// all pure data rules; no canvas, no SDK.
const { pickOffer, seekCandidates, OfferStats } = await load('ads/Offers');
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
