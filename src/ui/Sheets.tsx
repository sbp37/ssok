import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Game } from "../game/Game";
import { getBeadSprite } from "../game/beads/BeadSprites";
import type { BeadType } from "../game/beads/BeadTypes";
import { BEAD_TYPES, HIDDEN_TYPES, ULTRA_TYPES } from "../game/beads/BeadTypes";
import type { JarEntry } from "../game/rewards/album";
import { PADS, variantCount } from "../game/pads/PadTypes";
import { SHELF_SIZE, SPECIAL_TYPES, RARE_TYPES, TREASURE_TYPES } from "../game/rewards/treasure";
import { TREASURE_SETS } from "../game/rewards/sets";
import { HIDDEN_POOLS } from "../game/rewards/rates";
import { haptics } from "../game/haptics";
import { sfx } from "../game/audio/Sfx";
import { PadSilhouette } from "./NextPanel";
import { useShare } from "./share";

/** which pad hides this treasure most often – a nudge for the empty card, never a promise */
function hidesIn(typeId: string): string {
  let best: { pad: string; w: number } | null = null;
  for (const [padId, pool] of Object.entries(HIDDEN_POOLS)) {
    const e = pool.find((x) => x.id === typeId);
    if (e && (!best || e.w > best.w)) best = { pad: padId, w: e.w };
  }
  if (!best) return "";
  const pad = PADS.find((p) => p.id === best!.pad);
  return pad ? `${pad.name} 근처?` : "";
}

/** small bottom sheet – the only kind of "screen" the game has */
export function Sheet({ title, sub, onClose, children }: { title: string; sub?: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="sheet-wrap" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <span>
            {title}
            {sub && <small>{sub}</small>}
          </span>
          <button className="link" onClick={onClose}>
            닫기
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** bead drawn on a tiny canvas; unfound ones are dark silhouettes */
export function BeadIcon({ type, size, found }: { type: BeadType; size: number; found: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = c.height = Math.round(size * dpr);
    const ctx = c.getContext("2d")!;
    ctx.scale(dpr, dpr);
    const r = size * (type.shape === "oval" ? 0.26 : 0.36);
    const sp = getBeadSprite(type, type.colors[0], r, dpr);
    if (!found && "filter" in ctx) ctx.filter = "brightness(0) opacity(0.5)";
    ctx.drawImage(sp.canvas, size / 2 - sp.w / 2, size / 2 - sp.h / 2, sp.w, sp.h);
    ctx.filter = "none";
  }, [type, size, found]);
  return <canvas ref={ref} style={{ width: size, height: size }} />;
}

const asset = (name: string) => `${import.meta.env.BASE_URL}collection/${name}`;
const typeOf = (id: string) => TREASURE_TYPES.find((t) => t.id === id);
const dateLabel = (at?: number) => {
  if (!at) return "";
  const d = new Date(at);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
};

/** one treasure, up close: when and where it was first found, shelf / pin actions */
function TreasureDetail({ game, id, onClose }: { game: Game; id: string; onClose: () => void }) {
  const t = game.treasure;
  const type = typeOf(id);
  if (!type) return null;
  const n = t.count(id);
  const first = t.firstFound(id);
  const ultra = ULTRA_TYPES.some((u) => u.id === id);
  const pinnable = !n && HIDDEN_TYPES.some((h) => h.id === id);
  const shelfFull = t.shelf.length >= SHELF_SIZE && !t.onShelf(id);
  const where = n
    ? [dateLabel(first.at), first.pad ? `${first.pad} 패드에서 처음 찾음` : "처음 찾음"].filter(Boolean).join(" · ")
    : ultra ? "어느 패드든 아주 드물게 깊은 곳에" : hidesIn(id) ? `${hidesIn(id).replace("?", "")}에 자주 숨어` : "희귀 패드에서 잘 나와";
  return (
    <div className="detail-wrap" onClick={onClose}>
      <div className="detail" role="dialog" aria-label={n ? type.name : "아직 못 찾은 보물"} onClick={(e) => e.stopPropagation()}>
        <BeadIcon type={type} size={96} found={n > 0} />
        <div className="detail-name">{n ? type.name : "???"}</div>
        <div className="detail-sub">{n ? `×${n} · ${where}` : where}</div>
        {n > 0 && (
          <button
            className="btn"
            disabled={shelfFull}
            onClick={() => {
              haptics.press();
              t.toggleShelf(id);
              onClose();
            }}
          >
            {t.onShelf(id) ? "진열장에서 빼기" : shelfFull ? `진열장이 꽉 찼어 (${SHELF_SIZE}칸)` : "진열장에 놓기"}
          </button>
        )}
        {pinnable && (
          <button
            className="btn"
            onClick={() => {
              haptics.press();
              t.setTarget(t.target === id ? null : id);
              onClose();
            }}
          >
            {t.target === id ? "그만 찾기" : "📍 이거 찾을래"}
            <small>{t.target === id ? "지금 찾는 중" : "조금 더 자주 묻혀 있게 할게"}</small>
          </button>
        )}
        <button className="link" onClick={onClose}>
          닫기
        </button>
      </div>
    </div>
  );
}

const anyType = (id: string) => BEAD_TYPES.find((t) => t.id === id) ?? typeOf(id);

/** one emptied pad's jar: its beads settled in landing order under a small glass */
function MiniJar({ jar }: { jar: JarEntry }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const W = 64, H = 80;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = W * dpr;
    c.height = H * dpr;
    const ctx = c.getContext("2d")!;
    ctx.scale(dpr, dpr);
    // hex-packed from the bottom of the glass (inside x 12..52, y 30..72)
    const cols = 5, r = 40 / (cols * 2), rowH = r * 1.7;
    jar.beads.forEach(([id, color], i) => {
      const row = Math.floor(i / cols), col = i % cols;
      const x = 12 + r + col * r * 2 + (row % 2 ? -r * 0.4 : r * 0.4) * (col === 0 || col === cols - 1 ? 0 : 1) + Math.sin(i * 12.9898) * 0.5;
      const y = 72 - r - row * rowH;
      if (y < 30) return;
      const type = anyType(id);
      if (type) {
        // same sprite the jar uses in play, at album size
        const sp = getBeadSprite(type, color, r * (type.shape === "oval" ? 0.8 : 1.12), dpr);
        ctx.drawImage(sp.canvas, x - sp.w / 2, y - sp.h / 2, sp.w, sp.h);
      } else {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }, [jar]);
  const d = new Date(jar.at);
  return (
    <div className="mini-jar">
      <span className="mini-jar-glass">
        <canvas ref={ref} style={{ width: 64, height: 80 }} />
        <img src={asset("mini-jar.svg")} alt="" width={64} height={80} />
      </span>
      <span className="mini-jar-cap">
        {d.getMonth() + 1}/{d.getDate()} · {jar.pad}
      </span>
    </div>
  );
}

/** the album: the latest jars, three to a shelf */
function JarShelf({ game }: { game: Game }) {
  const jars = game.album.latest.slice(0, 6);
  if (!jars.length) {
    return (
      <div className="album-empty">
        <img src={asset("album-empty.svg")} alt="" width={120} height={90} />
        <span>패드를 다 비우면 병이 여기에 모여</span>
      </div>
    );
  }
  const rows: JarEntry[][] = [];
  for (let i = 0; i < jars.length; i += 3) rows.push(jars.slice(i, i + 3));
  return (
    <div className="album">
      {rows.map((row, i) => (
        <div key={i} className="album-row" style={{ backgroundImage: `url(${asset("jar-shelf.svg")})` }}>
          {row.map((j) => (
            <MiniJar key={j.at} jar={j} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** the shelf: up to five favourite treasures, on show */
function Shelf({ game, onPick }: { game: Game; onPick: (id: string) => void }) {
  const ids = game.treasure.shelf;
  return (
    <div className="shelf" style={{ backgroundImage: `url(${asset("shelf.svg")})` }}>
      {Array.from({ length: SHELF_SIZE }, (_, i) => {
        const id = ids[i];
        const type = id ? typeOf(id) : undefined;
        return (
          <button
            key={i}
            className={"shelf-slot" + (type ? "" : " empty")}
            style={{ left: `${10 + i * 20}%` }}
            disabled={!type}
            aria-label={type ? type.name : "빈 칸"}
            onClick={() => type && onPick(type.id)}
          >
            {type && <BeadIcon type={type} size={48} found />}
          </button>
        );
      })}
      {!ids.length && <div className="shelf-empty">보물을 찾으면 여기에 놓을 수 있어</div>}
    </div>
  );
}

/**
 * The collection: what you have seen. Pads in their real gel colours (dark ???
 * when not yet found), then the treasure box. Nothing here is tappable into
 * play – NEXT decides what you get; this is for looking.
 */
export function CollectionSheet({ game, onClose }: { game: Game; onClose: () => void }) {
  const [, tick] = useState(0);
  const [detail, setDetail] = useState<string | null>(null);
  const [shareNotice, setShareNotice] = useState("");
  const { busy: shareBusy, share } = useShare(setShareNotice);
  useEffect(() => {
    const a = game.treasure.subscribe(() => tick((n) => n + 1));
    const b = game.progressStore.subscribe(() => tick((n) => n + 1));
    return () => {
      a();
      b();
    };
  }, [game]);
  const t = game.treasure;
  const prog = game.progressStore;
  const foundPads = PADS.filter((p) => prog.isDiscovered(p.id)).length;
  const onShare = () => {
    setShareNotice("");
    void share();
  };
  return (
    <Sheet title="컬렉션" sub={`패드 ${foundPads}/${PADS.length} · 보물 ${t.found}/${t.total}`} onClose={onClose}>
      <div className="section">진열장</div>
      <Shelf game={game} onPick={setDetail} />
      <div className="section">세트</div>
      <div className="sets">
        {TREASURE_SETS.map((set) => {
          const have = set.ids.filter((id) => t.has(id)).length;
          const done = have === set.ids.length;
          return (
            <div key={set.id} className={"set-row" + (done ? " complete" : "")}>
              <span className="set-name">
                {done && <img src={asset("set-badge.svg")} alt="완성" width={20} height={20} />}
                {set.name}
              </span>
              <span className="set-items">
                {set.ids.map((id) => {
                  const ty = typeOf(id);
                  return ty ? (
                    <button key={id} className="set-item" onClick={() => setDetail(id)} aria-label={t.has(id) ? ty.name : "???"}>
                      <BeadIcon type={ty} size={28} found={t.has(id)} />
                    </button>
                  ) : null;
                })}
              </span>
              <span className="set-n">
                {have}/{set.ids.length}
              </span>
            </div>
          );
        })}
      </div>
      <div className="section">병 앨범{game.album.size ? ` · ${game.album.size}병` : ""}</div>
      <JarShelf game={game} />
      <div className="section">패드</div>
      <div className="grid pads">
        {PADS.map((p) => {
          const found = prog.isDiscovered(p.id);
          const vFound = prog.discoveredVariants.filter((id) => id.startsWith(p.id + ":")).length;
          return (
            <div key={p.id} className={"card" + (found ? "" : " unknown")}>
              <PadSilhouette pad={p} size={44} mode={found ? "color" : "dark"} glint={false} />
              <div className="card-name">{found ? p.name : "???"}</div>
              <div className="card-n">{found && vFound ? `변종 ${vFound}/${variantCount(p.id)}` : found ? `${prog.playCount(p.id)}회` : ""}</div>
            </div>
          );
        })}
      </div>
      {(
        [
          ["특수", SPECIAL_TYPES, (id: string) => t.specialCount(id)],
          ["희귀", RARE_TYPES, (id: string) => t.count(id)],
          ["초희귀", ULTRA_TYPES, (id: string) => t.count(id)],
        ] as const
      ).map(([title, types, countOf]) => (
        <div key={title}>
          <div className="section">{title}</div>
          <div className="grid">
            {types.map((ty) => {
              const n = countOf(ty.id);
              const treasure = title !== "특수";
              const pinned = t.target === ty.id;
              const body = (
                <>
                  {pinned && <img className="card-pin" src={asset("pin.svg")} alt="찾는 중" width={16} height={16} />}
                  <BeadIcon type={ty} size={44} found={n > 0} />
                  <div className="card-name">{n ? ty.name : "???"}</div>
                  <div className="card-n">{n ? `×${n}` : pinned ? "찾는 중" : hidesIn(ty.id)}</div>
                </>
              );
              return treasure ? (
                <button key={ty.id} className={"card tap" + (n ? "" : " unknown") + (pinned ? " pinned" : "")} onClick={() => setDetail(ty.id)}>
                  {body}
                </button>
              ) : (
                <div key={ty.id} className={"card" + (n ? "" : " unknown")}>
                  {body}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <div className="sheet-foot">보물을 누르면 진열하거나 📍 찾을 보물로 정할 수 있어.</div>
      <button className="collection-share" disabled={shareBusy} onClick={onShare}>
        <span aria-hidden="true">↗</span>
        {shareBusy ? "공유 준비 중…" : "친구에게 공유하기"}
      </button>
      {shareNotice && <div className="share-notice" role="status">{shareNotice}</div>}
      {detail && <TreasureDetail game={game} id={detail} onClose={() => setDetail(null)} />}
    </Sheet>
  );
}

/** sound / haptics live here, off the main screen */
export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const [soundOn, setSoundOn] = useState(sfx.enabled);
  const [hapticsOn, setHapticsOn] = useState(haptics.enabled);
  return (
    <Sheet title="설정" onClose={onClose}>
      <ul className="settings">
        <li>
          <span>소리</span>
          <button
            className={"switch" + (soundOn ? " on" : "")}
            aria-pressed={soundOn}
            onClick={() => {
              sfx.unlock();
              sfx.setEnabled(!soundOn);
              setSoundOn(!soundOn);
            }}
          >
            <i />
          </button>
        </li>
        <li>
          <span>진동</span>
          <button
            className={"switch" + (hapticsOn ? " on" : "")}
            aria-pressed={hapticsOn}
            onClick={() => {
              haptics.setEnabled(!hapticsOn);
              setHapticsOn(!hapticsOn);
              if (!hapticsOn) haptics.press();
            }}
          >
            <i />
          </button>
        </li>
      </ul>
    </Sheet>
  );
}
