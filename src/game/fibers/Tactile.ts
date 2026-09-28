import type { Bead } from "../beads/Bead";
import { REF_PAD_R } from "../beads/Bead";
import type { Rng } from "../util/math";
import { FIBER_SEGMENTS, installFibers } from "./Fiber";
import { bubbleDomes } from "./Bubble";

export type TactileKind = "fiber" | "chain" | "rainbow" | "charm" | "peel" | "swirl" | "bubble";

/** After the opening pad: every third pad is a swirl, the others rotate the
 * remaining materials. The new bubble film comes first and twice per cycle. */
export const ROUND_ROTATION = ["bubble", "chain", "swirl", "rainbow", "peel", "swirl", "bubble", "charm", "swirl"] as const;

/** Yarn is always present separately; this picks the round's second texture. */
export function roundTactile(completed: number): TactileKind | undefined {
  if (completed < 1) return "charm";
  return ROUND_ROTATION[(completed - 1) % ROUND_ROTATION.length];
}

/** Reuse safe slots, keeping the opening short while exposing two textures. */
export function installOpeningTactiles(beads: Bead[], padR: number, rng: Rng) {
  const charm = installTactile(beads, padR, rng, "charm");
  return [...charm, ...installFibers(beads, padR, rng, 2)];
}

/** Every regular pad keeps one familiar yarn, plus its rotating discovery.
 * Both replace safe existing slots, so the number of required pulls is unchanged. */
export function installRoundTactiles(beads: Bead[], padR: number, rng: Rng, featured: TactileKind, completed = 0) {
  const special = installTactile(beads, padR, rng, featured);
  return [...special, ...installFibers(beads, padR, rng, 1, completed)];
}

export function installTactile(beads: Bead[], padR: number, rng: Rng, kind: TactileKind) {
  if (kind === "fiber") return installFibers(beads, padR, rng);
  const scale = padR / REF_PAD_R;
  // Reuse an already allocated large slot: no displacement, added picks or rarity roll.
  // Real treasures and their hosts are never used by these surface treatments.
  const candidates = beads.filter(b => !b.fiber && b.layer === 0 && !b.hidden
    && ["common", "big", "odd"].includes(b.type.rarity)
    && !beads.some(other => other.layer === 1 && other.slot === b.slot));
  // Keep the surprise readable on a small phone: a near-centre, round host
  // scores a little higher than an equally sized bead tucked against the rim.
  const score = (b: Bead) => b.radius / scale - Math.hypot(b.rx, b.ry) / padR * 4
    + (b.type.shape === "circle" ? 1.5 : 0);
  candidates.sort((a, b) => score(b) - score(a));
  const b = candidates[0];
  if (!b) return [];
  const radius = b.radius / scale;
  const angle = rng.range(-.45, .45);
  if (kind === "bubble") {
    // the film sits over the bead's own slot; its domes are what gets pressed
    const domes = bubbleDomes(radius, angle - Math.PI / 2);
    const path = Array.from({ length: FIBER_SEGMENTS + 1 }, (_, i) => {
      const a = (i / FIBER_SEGMENTS) * Math.PI * 2;
      return { x: Math.cos(a) * radius * .96, y: Math.sin(a) * radius * .96 };
    });
    b.fiber = { kind, radius, path, length: domes.length, domes,
      color: "#d9f2fb", dark: "#7fb1c4", light: "#ffffff", pulled: 0, felt: 0, tip: { x: 0, y: 0 } };
    return [b];
  }
  const path = Array.from({length: FIBER_SEGMENTS + 1}, (_, i) => {
    const t = i / FIBER_SEGMENTS;
    if(kind === "swirl") { const a=t*Math.PI*4,r=radius*(.86-.68*t);return{x:Math.cos(a)*r,y:Math.sin(a)*r}; }
    const x = kind !== "peel" ? Math.sin(t * Math.PI * 2) * radius * .36 : 0;
    const y = (kind === "peel" ? .5 - t : t - .5) * radius * 1.5;
    return {x:x * Math.cos(angle) - y * Math.sin(angle), y:x * Math.sin(angle) + y * Math.cos(angle)};
  });
  const length = {chain:148,rainbow:190,charm:174,peel:94,swirl:100}[kind];
  b.fiber = {kind, radius, path, length,
    color: "#97d8ca", dark: "#608e99", light: "#e7fff6", pulled: 0, felt: 0,
    tip: kind === "peel" ? {x:radius * .58, y:radius * .7} : {...path[0]}};
  return [b];
}

export const tactileHint: Record<TactileKind, string> = {
  fiber: "컬러 실 끝을 잡고 쭈우욱",
  chain: "이어진 구슬을 당겨봐 · 뽁, 뽁, 뽁!",
  rainbow: "무지개 줄을 길게 · 또 하나, 또 하나!",
  charm: "작은 알 뒤에 큰 알이 숨어 있어 · 쭈욱!",
  swirl: "젤 끝을 잡고 빙글 · 어느 방향이든 돌려봐",
  peel: "반짝이는 막 끝을 잡고 벗겨봐",
  bubble: "볼록한 뽁뽁이를 눌러봐 · 뽁! 안에 비즈!",
};

/** how the NEXT tease names a pad's featured material */
export const tactileName: Record<TactileKind, string> = {
  fiber: "컬러 실",
  chain: "구슬 줄",
  rainbow: "무지개 줄",
  charm: "큰 알 줄",
  swirl: "소용돌이",
  peel: "젤 막",
  bubble: "뽁뽁이",
};
