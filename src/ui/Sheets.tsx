import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Game } from "../game/Game";
import { getBeadSprite } from "../game/beads/BeadSprites";
import type { BeadType } from "../game/beads/BeadTypes";
import { TREASURE_TYPES } from "../game/rewards/treasure";
import { haptics } from "../game/haptics";
import { sfx } from "../game/audio/Sfx";

/** small bottom sheet – the only kind of "screen" the game has */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="sheet-wrap" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <span>{title}</span>
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

export function TreasureSheet({ game, onClose }: { game: Game; onClose: () => void }) {
  const [, tick] = useState(0);
  useEffect(() => game.treasure.subscribe(() => tick((n) => n + 1)), [game]);
  const t = game.treasure;
  return (
    <Sheet title={`보물함 · ${t.found}/${t.total}`} onClose={onClose}>
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
      <div className="sheet-foot">아직 못 찾은 건 어느 패드에 숨어 있을까.</div>
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
