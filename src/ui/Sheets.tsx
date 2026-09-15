import { useEffect, useRef, useState, type ReactNode } from "react";
import { Environment, Share } from "@apps-in-toss/web-framework";
import type { Game } from "../game/Game";
import { getBeadSprite } from "../game/beads/BeadSprites";
import type { BeadType } from "../game/beads/BeadTypes";
import { ULTRA_TYPES } from "../game/beads/BeadTypes";
import { PADS, variantCount } from "../game/pads/PadTypes";
import { SPECIAL_TYPES, RARE_TYPES } from "../game/rewards/treasure";
import { HIDDEN_POOLS } from "../game/rewards/rates";
import { haptics } from "../game/haptics";
import { sfx } from "../game/audio/Sfx";
import { PadSilhouette } from "./NextPanel";

const SHARE_PAGE_URL = "https://sbp37.github.io/ssok/";
const SHARE_IMAGE_URL = `${SHARE_PAGE_URL}branding/share-stretch.jpg`;

async function shareCollection(): Promise<"shared" | "copied"> {
  let inToss = false;
  try {
    inToss = Environment.environment === "toss" || Environment.environment === "sandbox";
  } catch {
    // The normal web build has no Toss host constants.
  }

  if (inToss) {
    const link = await Share.createLink({
      path: "intoss://ssok-picky-pad/",
      ogImageUrl: SHARE_IMAGE_URL,
    });
    await Share.sendMessage({
      message: `쭈우욱… 쏙!\n말랑한 젤 비즈를 뽑아봐\n${link}`,
    });
    return "shared";
  }

  if (navigator.share) {
    await navigator.share({
      title: "쏙: 피키패드",
      text: "쭈우욱… 쏙! 말랑한 젤 비즈를 뽑아봐",
      url: SHARE_PAGE_URL,
    });
    return "shared";
  }
  await navigator.clipboard.writeText(SHARE_PAGE_URL);
  return "copied";
}

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

/**
 * The collection: what you have seen. Pads in their real gel colours (dark ???
 * when not yet found), then the treasure box. Nothing here is tappable into
 * play – NEXT decides what you get; this is for looking.
 */
export function CollectionSheet({ game, onClose }: { game: Game; onClose: () => void }) {
  const [, tick] = useState(0);
  const sharing = useRef(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareNotice, setShareNotice] = useState("");
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
  const onShare = async () => {
    if (sharing.current) return;
    sharing.current = true;
    setShareBusy(true);
    setShareNotice("");
    try {
      const result = await shareCollection();
      if (result === "copied") setShareNotice("링크를 복사했어.");
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) {
        setShareNotice("공유를 열지 못했어. 잠시 후 다시 눌러 줘.");
      }
    } finally {
      sharing.current = false;
      setShareBusy(false);
    }
  };
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
              return (
                <div key={ty.id} className={"card" + (n ? "" : " unknown")}>
                  <BeadIcon type={ty} size={44} found={n > 0} />
                  <div className="card-name">{n ? ty.name : "???"}</div>
                  <div className="card-n">{n ? `×${n}` : hidesIn(ty.id)}</div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <div className="sheet-foot">빈칸은 어느 패드에 숨어 있을까.</div>
      <button className="collection-share" disabled={shareBusy} onClick={() => void onShare()}>
        <span aria-hidden="true">↗</span>
        {shareBusy ? "공유 준비 중…" : "친구에게 공유하기"}
      </button>
      {shareNotice && <div className="share-notice" role="status">{shareNotice}</div>}
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
