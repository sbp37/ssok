import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Game } from "../game/Game";
import { getBeadSprite } from "../game/beads/BeadSprites";
import type { BeadType } from "../game/beads/BeadTypes";
import { PADS, variantCount } from "../game/pads/PadTypes";
import { TREASURE_TYPES } from "../game/rewards/treasure";
import { haptics } from "../game/haptics";
import { sfx } from "../game/audio/Sfx";
import { PadSilhouette } from "./NextPanel";

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

/**
 * The collection: what you have seen. Pads in their real gel colours (dark ???
 * when not yet found), then the treasure box. Nothing here is tappable into
 * play – NEXT decides what you get; this is for looking.
 */
export function CollectionSheet({ game, onClose }: { game: Game; onClose: () => void }) {
  const [, tick] = useState(0);
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
  return (
    <Sheet title="컬렉션" sub={`패드 ${foundPads}/${PADS.length} · 보물 ${t.found}/${t.total}`} onClose={onClose}>
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
      <div className="section">보물</div>
      <div className="grid">
        {TREASURE_TYPES.map((ty) => {
          const n = t.count(ty.id);
          return (
            <div key={ty.id} className={"card" + (n ? "" : " unknown")}>
              <BeadIcon type={ty} size={44} found={n > 0} />
              <div className="card-name">{n ? ty.name : "???"}</div>
              <div className="card-n">{n ? `×${n}` : ""}</div>
            </div>
          );
        })}
      </div>
      <div className="sheet-foot">빈칸은 어느 패드에 숨어 있을까.</div>
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
