import { useEffect, useMemo, useRef, useState } from "react";
import { File as TossFile } from "@apps-in-toss/web-framework";
import type { Game } from "../game/Game";
import { getBeadSprite } from "../game/beads/BeadSprites";
import { BEAD_TYPES } from "../game/beads/BeadTypes";
import { TREASURE_TYPES } from "../game/rewards/treasure";
import { AD_CORD, CORDS, CORD_NAMES, MAX_BEADS, MIN_BEADS, splitKey, type Bracelet, type Cord } from "../game/rewards/bracelets";
import { haptics } from "../game/haptics";
import { track } from "../game/analytics";

/** what a bracelet looks like – a saved one or the one being strung */
export interface BraceletLook {
  beads: readonly string[];
  charm: string | null;
  cord: Cord;
}
/** the rewarded ad behind the glitter cord, run by the app (sound, pacing, analytics) */
export interface AdHook {
  ready(): boolean;
  watch(): Promise<boolean>;
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const beadType = (id: string) => BEAD_TYPES.find((t) => t.id === id);
const treasureType = (id: string) => TREASURE_TYPES.find((t) => t.id === id);
const FONT = 'Pretendard, -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';

function strokeCord(ctx: CanvasRenderingContext2D, cord: Cord, cx: number, cy: number, R: number, size: number) {
  const w = Math.max(1.5, size * 0.012);
  const ring = () => {
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();
  };
  ctx.save();
  if (cord === "clear") {
    ctx.lineWidth = w * 1.6;
    ctx.strokeStyle = "rgba(43,39,48,0.12)";
    ring();
    ctx.lineWidth = w;
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ring();
  } else if (cord === "pink") {
    ctx.lineWidth = w;
    ctx.strokeStyle = "#f19ec2";
    ring();
  } else if (cord === "gold") {
    const g = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
    g.addColorStop(0, "#f7df93");
    g.addColorStop(0.5, "#d2a640");
    g.addColorStop(1, "#f3d27c");
    ctx.lineWidth = w;
    ctx.strokeStyle = g;
    ring();
  } else {
    const g = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
    g.addColorStop(0, "#e9d4ff");
    g.addColorStop(0.5, "#ffd0e6");
    g.addColorStop(1, "#ffe9b0");
    ctx.lineWidth = w * 1.5;
    ctx.strokeStyle = g;
    ring();
    // a sprinkle of sparkles along the cord (fixed places: the same bracelet looks the same)
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2 + (i % 3) * 0.05;
      const r = w * (i % 4 === 0 ? 0.95 : 0.55);
      ctx.fillStyle = i % 5 === 0 ? "rgba(255,214,120,0.95)" : "rgba(255,255,255,0.95)";
      ctx.beginPath();
      ctx.arc(cx + R * Math.cos(a), cy + R * Math.sin(a), r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/**
 * A bracelet on a canvas `size` px square: the cord as a ring, the beads evenly
 * around it from the top clockwise, the charm hanging from the bottom on a jump
 * ring. `ghost`: at least this many slots, the empty ones as faint dots (while stringing).
 */
export function drawBracelet(ctx: CanvasRenderingContext2D, size: number, dpr: number, b: BraceletLook, ghost = 0) {
  const cx = size / 2;
  const cy = size * 0.4;
  const R = size * 0.29;
  const n = b.beads.length;
  const slots = Math.max(n, ghost, 1);
  const base = Math.min(((Math.PI * R) / slots) * 0.95, size * 0.075);
  const radiusOf = (key: string) => {
    const t = beadType(splitKey(key).typeId);
    return t ? base * clamp((t.radius[0] + t.radius[1]) / 2 / 12.5, 0.75, 1.45) : base;
  };
  strokeCord(ctx, b.cord, cx, cy, R, size);
  // the charm's jump ring sits on the cord behind the bottom bead; the charm hangs below that bead
  const ct = b.charm ? treasureType(b.charm) : undefined;
  let bottom = base;
  if (n) {
    const i = Math.round(slots / 2);
    if (i < n) bottom = radiusOf(b.beads[i]);
  }
  const loop = size * 0.028;
  const ringY = cy + R + bottom * 0.8;
  if (ct) {
    ctx.save();
    ctx.strokeStyle = "#d2a640";
    ctx.lineWidth = Math.max(1.2, size * 0.008);
    ctx.beginPath();
    ctx.moveTo(cx, cy + R);
    ctx.lineTo(cx, ringY - loop);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, ringY, loop, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  for (let i = n; i < slots; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / slots;
    ctx.fillStyle = "rgba(180,87,127,0.16)";
    ctx.beginPath();
    ctx.arc(cx + R * Math.cos(a), cy + R * Math.sin(a), base * 0.42, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < n; i++) {
    const { typeId, color } = splitKey(b.beads[i]);
    const t = beadType(typeId);
    if (!t) continue;
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / slots;
    const r = radiusOf(b.beads[i]);
    const sp = getBeadSprite(t, color, r, dpr);
    ctx.save();
    ctx.translate(cx + R * Math.cos(a), cy + R * Math.sin(a));
    // long beads lie along the cord
    if (t.shape === "oval") ctx.rotate(a + Math.PI / 2);
    ctx.drawImage(sp.canvas, -sp.w / 2, -sp.h / 2, sp.w, sp.h);
    ctx.restore();
  }
  if (ct) {
    const r = size * 0.08;
    const sp = getBeadSprite(ct, ct.colors[0], r, dpr);
    ctx.drawImage(sp.canvas, cx - sp.w / 2, ringY + loop + r * 0.9 - sp.h / 2, sp.w, sp.h);
  }
  // the glitter cord shows off: little four-point sparkles around the bracelet, over the beads
  if (b.cord === "glitter") {
    for (let i = 0; i < 9; i++) {
      const a = -Math.PI / 2 + 0.35 + (i / 9) * Math.PI * 2;
      const d = R + base * (i % 2 ? 1.05 : -1.0);
      sparkle(ctx, cx + d * Math.cos(a), cy + d * Math.sin(a), size * (i % 3 ? 0.016 : 0.024), i % 4 === 0 ? "#ffd36b" : "#ffffff");
    }
  }
}

function sparkle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.shadowColor = "rgba(255,255,255,0.9)";
  ctx.shadowBlur = r * 1.5;
  ctx.beginPath();
  for (let k = 0; k < 8; k++) {
    const rr = k % 2 ? r * 0.28 : r;
    const a = (k * Math.PI) / 4;
    ctx.lineTo(rr * Math.cos(a), rr * Math.sin(a));
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function BraceletRing({ look, size, ghost = 0 }: { look: BraceletLook; size: number; ghost?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const sig = `${look.beads.join(",")}/${look.charm}/${look.cord}/${ghost}/${size}`;
  useEffect(() => {
    const c = ref.current!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = c.height = Math.round(size * dpr);
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    drawBracelet(ctx, size, dpr, look, ghost);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  return <canvas ref={ref} style={{ width: size, height: size }} aria-hidden="true" />;
}

/** one bead in its own colour */
function BeadChip({ typeId, color, size, dark = false }: { typeId: string; color: string; size: number; dark?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const t = beadType(typeId) ?? treasureType(typeId);
    const c = ref.current!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = c.height = Math.round(size * dpr);
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    if (!t) return;
    const sp = getBeadSprite(t, color, size * (t.shape === "oval" ? 0.26 : 0.34), dpr);
    if (dark && "filter" in ctx) ctx.filter = "brightness(0) opacity(0.45)";
    ctx.drawImage(sp.canvas, size / 2 - sp.w / 2, size / 2 - sp.h / 2, sp.w, sp.h);
    ctx.filter = "none";
  }, [typeId, color, size, dark]);
  return <canvas ref={ref} style={{ width: size, height: size }} aria-hidden="true" />;
}

/** rainbow order for the bead tray: hue, then the pale and white ones last */
function trayOrder(key: string) {
  const hex = splitKey(key).color.slice(1);
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
  if (s < 0.18 || max - min < 0.08) return 400 + (1 - l) * 100;
  let h = max === r ? ((g - b) / (max - min)) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

/** the bracelet maker: tap beads to string them, pick a cord and a charm, done */
export function BraceletMaker({ game, ads, onClose, onMade }: { game: Game; ads: AdHook; onClose: () => void; onMade: (b: Bracelet) => void }) {
  const store = game.bracelets;
  const [beads, setBeads] = useState<string[]>([]);
  const [charm, setCharm] = useState<string | null>(null);
  const [cord, setCord] = useState<Cord>(store.hasGlitter ? AD_CORD : "clear");
  const [watching, setWatching] = useState(false);
  const [note, setNote] = useState("");
  // beads and treasures can still arrive while the maker is open (the last flights of a pad)
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const a = store.subscribe(() => setVersion((v) => v + 1));
    const b = game.treasure.subscribe(() => setVersion((v) => v + 1));
    return () => {
      a();
      b();
    };
  }, [store, game]);
  const glitter = store.hasGlitter;
  const tray = useMemo(
    () => store.spareBeads().sort((a, b) => trayOrder(a.key) - trayOrder(b.key) || a.key.localeCompare(b.key)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, version],
  );
  const charms = useMemo(
    () => TREASURE_TYPES.map((t) => ({ t, free: store.charmFree(t.id, game.treasure.count(t.id)) })).filter((c) => c.free > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, game, version],
  );
  useEffect(() => track("bracelet_open"), []);
  const left = (key: string, spare: number) => spare - beads.filter((k) => k === key).length;
  const add = (key: string, spare: number) => {
    if (beads.length >= MAX_BEADS || left(key, spare) <= 0) return;
    haptics.press();
    setNote("");
    setBeads((bs) => [...bs, key]);
  };
  const pickCord = async (c: Cord) => {
    if (c !== AD_CORD || glitter) {
      setCord(c);
      return;
    }
    if (!ads.ready()) {
      setNote("광고를 불러오는 중이야. 잠시 뒤에 다시 눌러 줘");
      return;
    }
    setWatching(true);
    const ok = await ads.watch();
    setWatching(false);
    if (ok) {
      setCord(c);
      setNote("반짝이 줄 ✦ 다음 팔찌 하나에 쓸 수 있어");
    } else setNote("광고를 끝까지 보면 반짝이 줄을 쓸 수 있어");
  };
  const finish = () => {
    const b = store.make(beads, charm, cord, (id) => game.treasure.count(id));
    if (!b) {
      setNote("팔찌를 만들지 못했어. 비즈를 다시 골라 줘");
      return;
    }
    haptics.press();
    track("bracelet_made", { beads: b.beads.length, charm: !!b.charm, cord: b.cord });
    onMade(b);
  };
  return (
    <div className="detail-wrap maker-wrap" onClick={onClose}>
      <div className="maker" role="dialog" aria-label="팔찌 만들기" onClick={(e) => e.stopPropagation()}>
        <div className="maker-head">
          <strong>팔찌 만들기</strong>
          <button className="link" onClick={onClose}>
            닫기
          </button>
        </div>
        <div className="maker-preview">
          <BraceletRing look={{ beads, charm, cord }} size={196} ghost={MIN_BEADS} />
        </div>
        <div className="maker-count">
          <span>
            {beads.length}/{MAX_BEADS}알 {beads.length < MIN_BEADS ? `· ${MIN_BEADS - beads.length}알 더` : ""}
          </span>
          <button className="link" disabled={!beads.length} onClick={() => setBeads((bs) => bs.slice(0, -1))}>
            하나 빼기
          </button>
          <button className="link" disabled={!beads.length} onClick={() => setBeads([])}>
            비우기
          </button>
        </div>
        <div className="maker-label">줄</div>
        <div className="cords">
          {CORDS.map((c) => (
            <button key={c} className={"cord" + (cord === c ? " on" : "")} onClick={() => void pickCord(c)} disabled={watching}>
              <i className={"cord-dot " + c} />
              {CORD_NAMES[c]}
              {c === AD_CORD && !glitter && <small>{watching ? "잠깐…" : "광고"}</small>}
            </button>
          ))}
        </div>
        <div className="maker-label">참 {charms.length ? "· 보물 하나" : ""}</div>
        {charms.length ? (
          <div className="charms">
            {charms.map(({ t, free }) => (
              <button key={t.id} className={"charm" + (charm === t.id ? " on" : "")} onClick={() => setCharm(charm === t.id ? null : t.id)} aria-label={t.name}>
                <BeadChip typeId={t.id} color={t.colors[0]} size={36} />
                {free > 1 && <small>×{free}</small>}
              </button>
            ))}
          </div>
        ) : (
          <div className="maker-empty">보물을 찾으면 참으로 달 수 있어</div>
        )}
        <div className="maker-label">비즈 · 누르면 꿰어져</div>
        <div className="tray">
          {tray.map(({ key, n }) => {
            const { typeId, color } = splitKey(key);
            const rest = left(key, n);
            return (
              <button key={key} className="tray-bead" disabled={rest <= 0 || beads.length >= MAX_BEADS} onClick={() => add(key, n)}>
                <BeadChip typeId={typeId} color={color} size={34} />
                <small>{rest}</small>
              </button>
            );
          })}
        </div>
        {note && <div className="maker-note" role="status">{note}</div>}
        <button className="btn maker-done" disabled={beads.length < MIN_BEADS || watching} onClick={finish}>
          {beads.length < MIN_BEADS ? `${MIN_BEADS}알부터 완성할 수 있어` : "완성!"}
        </button>
      </div>
    </div>
  );
}

/** the bracelet as a picture to keep: soft background, the bracelet large, a caption */
export async function saveBraceletImage(b: BraceletLook): Promise<"saved" | "downloaded" | "failed"> {
  const S = 1080;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d");
  if (!ctx) return "failed";
  const g = ctx.createLinearGradient(0, 0, S, S);
  g.addColorStop(0, "#fff6fa");
  g.addColorStop(1, "#f1ecff");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  ctx.save();
  ctx.translate(100, 30);
  drawBracelet(ctx, 880, 1, b);
  ctx.restore();
  ctx.textAlign = "center";
  ctx.fillStyle = "#2b2730";
  ctx.font = `700 46px ${FONT}`;
  ctx.fillText("내가 만든 팔찌 ✦", S / 2, S - 104);
  ctx.fillStyle = "rgba(43,39,48,0.5)";
  ctx.font = `500 30px ${FONT}`;
  ctx.fillText("쏙! 피키패드", S / 2, S - 58);
  const url = c.toDataURL("image/png");
  const d = new Date();
  const name = `ssok-bracelet-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}.png`;
  let inToss = false;
  try {
    inToss = TossFile.saveBase64.isSupported();
  } catch {
    inToss = false;
  }
  if (inToss) {
    try {
      await TossFile.saveBase64({ data: url.split(",")[1], fileName: name, mimeType: "image/png" });
      return "saved";
    } catch {
      return "failed";
    }
  }
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    return "downloaded";
  } catch {
    return "failed";
  }
}

/** one saved bracelet, up close: keep it as a picture, show it off, or untie it */
export function BraceletView({
  bracelet,
  onClose,
  onUntie,
  onShare,
}: {
  bracelet: Bracelet;
  onClose: () => void;
  onUntie: () => void;
  onShare: () => void;
}) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const charm = bracelet.charm ? treasureType(bracelet.charm) : undefined;
  const d = new Date(bracelet.at);
  const save = async () => {
    setSaving(true);
    const r = await saveBraceletImage(bracelet);
    setSaving(false);
    track(r === "failed" ? "bracelet_save_failed" : "bracelet_saved");
    setNote(r === "saved" ? "사진으로 저장했어 ✦" : r === "downloaded" ? "이미지를 내려받았어 ✦" : "저장하지 못했어. 잠시 후 다시 해 줘");
  };
  return (
    <div className="detail-wrap" onClick={onClose}>
      <div className="detail bracelet-detail" role="dialog" aria-label="팔찌" onClick={(e) => e.stopPropagation()}>
        <BraceletRing look={bracelet} size={220} />
        <div className="detail-sub">
          {d.getMonth() + 1}월 {d.getDate()}일 · {bracelet.beads.length}알 · {CORD_NAMES[bracelet.cord]}
          {charm ? ` · ${charm.name} 참` : ""}
        </div>
        <button className="btn" onClick={() => void save()} disabled={saving}>
          {saving ? "저장 중…" : "사진으로 저장"}
        </button>
        <button className="btn ghost" onClick={onShare}>
          자랑하기 ↗
        </button>
        {note && <div className="maker-note" role="status">{note}</div>}
        {confirm ? (
          <button
            className="link danger"
            onClick={() => {
              track("bracelet_untied");
              onUntie();
            }}
          >
            정말 풀래? 비즈와 참은 돌아와
          </button>
        ) : (
          <button className="link" onClick={() => setConfirm(true)}>
            팔찌 풀기
          </button>
        )}
        <button className="link" onClick={onClose}>
          닫기
        </button>
      </div>
    </div>
  );
}

/** the bracelet box in the collection: a "make" tile, then the bracelets kept */
export function BraceletBox({ game, onMake, onOpen }: { game: Game; onMake: () => void; onOpen: (b: Bracelet) => void }) {
  const store = game.bracelets;
  const spare = store.spareTotal;
  const canMake = spare >= MIN_BEADS && !store.full;
  return (
    <div className="bracelets">
      <button className="bracelet-tile make" onClick={onMake} disabled={!canMake}>
        <span className="plus">+</span>
        <span className="make-name">{store.full ? "팔찌함이 꽉 찼어" : spare < MIN_BEADS ? `비즈 ${MIN_BEADS}개부터` : "팔찌 만들기"}</span>
        <small>비즈 {spare}개</small>
      </button>
      {store.bracelets.map((b) => (
        <button key={b.id} className="bracelet-tile" onClick={() => onOpen(b)} aria-label="팔찌 보기">
          <BraceletRing look={b} size={70} />
        </button>
      ))}
    </div>
  );
}
