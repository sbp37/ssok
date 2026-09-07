import { useEffect, useRef, useState } from "react";
import { Game } from "../game/Game";
import type { PadType } from "../game/pads/PadTypes";
import { sfx } from "../game/audio/Sfx";
import { NextPanel } from "./NextPanel";
import { SettingsSheet, TreasureSheet } from "./Sheets";

interface Toast {
  id: number;
  text: string;
  sub?: string;
  tone: "rare" | "hidden" | "ultra";
}

type Phase = "intro" | "free";

/**
 * The whole UI: a count, one treasure-box button, a tiny settings button, the
 * NEXT tease, and the door to the next pad. The pad is the screen.
 */
export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const timers = useRef<number[]>([]);
  const [phase, setPhase] = useState<Phase>("intro");
  const [hintHidden, setHintHidden] = useState(false);
  const [pulled, setPulled] = useState(0);
  const [padEmpty, setPadEmpty] = useState(false);
  // pad flow
  const [emptied, setEmptied] = useState(0);
  const [nextPad, setNextPad] = useState<PadType | null>(null);
  const [rareNext, setRareNext] = useState(false);
  /** "" → playing · "done" → "다 비웠다." · "ready" → the open button */
  const [flow, setFlow] = useState<"" | "done" | "ready">("");
  const [watching, setWatching] = useState(false);
  // finds
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [boxPulse, setBoxPulse] = useState<{ n: number; strong: boolean }>({ n: 0, strong: false });
  const [glimmer, setGlimmer] = useState(false);
  const [sheet, setSheet] = useState<"" | "treasure" | "settings">("");
  const toastId = useRef(0);

  const later = (fn: () => void, ms: number) => {
    const t = window.setTimeout(fn, ms);
    timers.current.push(t);
  };
  const pushToast = (t: Omit<Toast, "id">) => {
    const id = ++toastId.current;
    setToasts((ts) => [...ts.slice(-1), { ...t, id }]);
    later(() => setToasts((ts) => ts.filter((x) => x.id !== id)), t.tone === "ultra" ? 2600 : 1700);
  };

  useEffect(() => {
    const canvas = canvasRef.current!;
    const game = new Game(canvas);
    gameRef.current = game;
    (window as unknown as { __ssok?: Game }).__ssok = game;
    const offs = [
      game.on("pop", ({ pulled }) => {
        setPulled(pulled);
        setPadEmpty(false);
      }),
      game.on("firstPop", () => {
        setHintHidden(true);
        setPhase("free");
      }),
      game.on("padEmpty", () => {
        setPadEmpty(true);
        setNextPad(game.nextPad);
        setRareNext(game.nextIsRare);
        // hold the empty pad (and the full jar) for a beat, say it quietly, then offer the door
        later(() => setFlow("done"), 550);
        later(() => setFlow("ready"), 1550);
      }),
      game.on("progress", ({ emptied }) => {
        setEmptied(emptied);
        if (emptied >= 0.68) {
          setNextPad(game.nextPad);
          // a passive nudge, once, when something unseen is still buried in there
          setGlimmer((g) => {
            if (g) return g;
            const info = game.hiddenInfo;
            if (info && info.isNew) {
              later(() => setGlimmer(false), 2600);
              return true;
            }
            return g;
          });
        }
      }),
      game.on("padChange", () => {
        setEmptied(0);
        setPadEmpty(false);
        setFlow("");
        setNextPad(null);
        setGlimmer(false);
      }),
      game.on("treasure", ({ type, kind, isNew, count, padName }) => {
        // a repeat rare only makes the box blink; new things and buried things get a short line
        setBoxPulse((p) => ({ n: p.n + 1, strong: kind !== "rare" || isNew }));
        if (kind === "ultra") pushToast({ tone: "ultra", text: "뭐야 이거?", sub: `${isNew ? "NEW ✦ " : ""}${type.name}` });
        else if (kind === "hidden") pushToast({ tone: "hidden", text: `${padName} 속 ${type.name} 발견`, sub: isNew ? "처음 발견했어 ✦" : `+1 · 모두 ${count}개` });
        else if (isNew) pushToast({ tone: "rare", text: `NEW ✦ ${type.name}` });
      }),
    ];
    return () => {
      offs.forEach((off) => off());
      timers.current.forEach((t) => window.clearTimeout(t));
      game.destroy();
      gameRef.current = null;
    };
  }, []);

  const openNext = () => {
    const g = gameRef.current;
    if (!g) return;
    sfx.unlock();
    g.openPad(g.nextPad);
  };
  /** a rare variant is passing: "광고 보고 잡기" → (mock) rewarded → open it. "그냥 다음" → the plain pad. */
  const catchRare = async () => {
    const g = gameRef.current;
    if (!g || watching) return;
    setWatching(true);
    const ok = await g.rewarded.watch();
    setWatching(false);
    if (ok) g.openPad(g.nextPad);
    else g.openNextPlain();
  };
  const skipRare = () => gameRef.current?.openNextPlain();

  return (
    <div className="stage">
      <div className="playfield">
        <canvas ref={canvasRef} />
        <div className="ui">
          <div className="hud">
            <div className="hud-left">
              {phase !== "intro" && (
                <span className="count">
                  {pulled}
                  <small>개</small>
                </span>
              )}
            </div>
            <div className="right">
              <button
                className={"pill box" + (boxPulse.n ? (boxPulse.strong ? " pulse" : " blink") : "")}
                key={boxPulse.n}
                onClick={() => setSheet("treasure")}
              >
                보물함
              </button>
              <button className="pill tiny" onClick={() => setSheet("settings")} aria-label="설정">
                ⚙
              </button>
            </div>
          </div>

          {phase === "intro" && <div className={"hint" + (hintHidden ? " hide" : "")}>하나 뽑아봐.</div>}
          {phase === "free" && padEmpty && flow !== "" && <div className="done">다 비웠다.</div>}
          {phase === "free" && glimmer && !padEmpty && <div className="glimmer">안쪽에서 뭔가 반짝인다…</div>}

          {toasts.length > 0 && (
            <div className="toasts">
              {toasts.map((t) => (
                <div key={t.id} className={"toast " + t.tone}>
                  <div>{t.text}</div>
                  {t.sub && <small>{t.sub}</small>}
                </div>
              ))}
            </div>
          )}

          <div className="bottom">
            {phase === "free" && nextPad && (emptied >= 0.68 || padEmpty) && (
              <NextPanel pad={nextPad} emphasis={padEmpty ? 1 : 0} gated={rareNext} />
            )}
            {phase === "free" && padEmpty && flow === "ready" && nextPad && !rareNext && (
              <button className="btn" onClick={openNext}>
                다음 패드 열기
              </button>
            )}
            {phase === "free" && padEmpty && flow === "ready" && nextPad && rareNext && (
              <div className="gate">
                <button className="btn" onClick={catchRare} disabled={watching}>
                  {watching ? "잠깐…" : "광고 보고 잡기"}
                  <small>희귀 패드</small>
                </button>
                <button className="link" onClick={skipRare}>
                  그냥 다음
                </button>
              </div>
            )}
          </div>
        </div>
        {sheet === "treasure" && gameRef.current && <TreasureSheet game={gameRef.current} onClose={() => setSheet("")} />}
        {sheet === "settings" && <SettingsSheet onClose={() => setSheet("")} />}
      </div>
      {/* reserved for the bottom banner ad – no game content ever draws here */}
      <div className="ad-slot" aria-hidden="true">
        <span>광고 영역</span>
      </div>
    </div>
  );
}
