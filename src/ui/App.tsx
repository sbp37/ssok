import { useEffect, useRef, useState } from "react";
import { Game } from "../game/Game";
import type { ChallengeResult } from "../game/modes/Challenge";
import { haptics } from "../game/haptics";
import { sfx } from "../game/audio/Sfx";
import { useCountUp } from "./useCountUp";
import { NextPanel } from "./NextPanel";
import type { PadType } from "../game/pads/PadTypes";

type Phase = "intro" | "free" | "challenge" | "result";

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const timers = useRef<number[]>([]);
  const [phase, setPhase] = useState<Phase>("intro");
  const [hintHidden, setHintHidden] = useState(false);
  const [showChallenge, setShowChallenge] = useState(false);
  const [pulled, setPulled] = useState(0);
  const [remaining, setRemaining] = useState(30);
  const [combo, setCombo] = useState(0);
  const [rareKey, setRareKey] = useState(0);
  const [padEmpty, setPadEmpty] = useState(false);
  const [result, setResult] = useState<{ r: ChallengeResult; isBest: boolean; best: ChallengeResult | null } | null>(null);
  const [hapticsOn, setHapticsOn] = useState(haptics.enabled);
  const [soundOn, setSoundOn] = useState(sfx.enabled);
  // pad flow (free mode)
  const [emptied, setEmptied] = useState(0);
  const [nextPad, setNextPad] = useState<PadType | null>(null);
  const [gated, setGated] = useState(false);
  /** "" → playing · "done" → "다 비웠다." · "ready" → the open button */
  const [flow, setFlow] = useState<"" | "done" | "ready">("");
  const [watching, setWatching] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const game = new Game(canvas);
    gameRef.current = game;
    (window as unknown as { __ssok?: Game }).__ssok = game;
    const offs = [
      game.on("pop", ({ pulled, combo, rare }) => {
        setPulled(pulled);
        setCombo(combo);
        if (rare) setRareKey((k) => k + 1);
        setPadEmpty(false);
      }),
      game.on("firstPop", () => {
        setHintHidden(true);
        setPhase("free");
        window.setTimeout(() => setShowChallenge(true), 2000);
      }),
      game.on("tick", ({ remaining, pulled, combo }) => {
        setRemaining(remaining);
        setPulled(pulled);
        setCombo(combo);
      }),
      game.on("challengeStart", () => {
        setPhase("challenge");
        setPulled(0);
        setCombo(0);
        setRemaining(30);
        setResult(null);
        setPadEmpty(false);
      }),
      game.on("challengeEnd", ({ result, isBest, best }) => {
        setResult({ r: result, isBest, best });
        setPhase("result");
      }),
      game.on("padEmpty", () => {
        setPadEmpty(true);
        setNextPad(game.nextPad);
        setGated(game.nextGated);
        // hold the empty pad for a beat, then say it quietly, then offer the door
        const t1 = window.setTimeout(() => setFlow("done"), 550);
        const t2 = window.setTimeout(() => setFlow("ready"), 1550);
        timers.current.push(t1, t2);
      }),
      game.on("progress", ({ emptied }) => {
        setEmptied(emptied);
        if (emptied >= 0.68) setNextPad(game.nextPad);
      }),
      game.on("padChange", () => {
        setEmptied(0);
        setPadEmpty(false);
        setFlow("");
        setNextPad(null);
      }),
    ];
    setNextPad(null);
    return () => {
      offs.forEach((off) => off());
      timers.current.forEach((t) => window.clearTimeout(t));
      game.destroy();
      gameRef.current = null;
    };
  }, []);

  const start = () => {
    sfx.unlock();
    gameRef.current?.startChallenge();
  };
  const goFree = () => {
    gameRef.current?.goFree();
    setPhase("free");
    setResult(null);
    setPulled(0);
    setPadEmpty(false);
  };
  const openNext = () => {
    const g = gameRef.current;
    if (!g) return;
    sfx.unlock();
    g.openPad(g.nextPad);
  };
  /** gated: "지금 열기" → (mock) rewarded → open. "나중에" → a pad you already know instead. */
  const openWithReward = async () => {
    const g = gameRef.current;
    if (!g || watching) return;
    setWatching(true);
    const ok = await g.rewarded.watch();
    setWatching(false);
    if (ok) g.openPad(g.nextPad);
  };
  const openLater = () => {
    const g = gameRef.current;
    if (!g) return;
    g.openPad(g.progressStore.fallback(g.nextPad.id));
  };

  const inChallenge = phase === "challenge";

  return (
    <div className="stage">
      <canvas ref={canvasRef} />
      <div className="ui">
        <div className="hud">
          <div className="hud-left">
            {inChallenge && (
              <span className={"timer" + (remaining <= 5 ? " low" : "")}>{remaining.toFixed(1)}</span>
            )}
            {phase !== "intro" && phase !== "result" && (
              <span className="count">
                {pulled}
                <small>개</small>
              </span>
            )}
            {inChallenge && combo >= 3 && (
              <span className="combo" key={combo}>
                ×{combo}
              </span>
            )}
          </div>
          <div className="toggles">
            <button
              className={soundOn ? "" : "off"}
              onClick={() => {
                sfx.unlock();
                sfx.setEnabled(!soundOn);
                setSoundOn(!soundOn);
              }}
              aria-pressed={soundOn}
            >
              소리
            </button>
            <button
              className={hapticsOn ? "" : "off"}
              onClick={() => {
                haptics.setEnabled(!hapticsOn);
                setHapticsOn(!hapticsOn);
                if (!hapticsOn) haptics.press();
              }}
              aria-pressed={hapticsOn}
            >
              진동
            </button>
          </div>
        </div>

        {phase === "intro" && <div className={"hint" + (hintHidden ? " hide" : "")}>하나 뽑아봐.</div>}
        {rareKey > 0 && (
          <div className="rare" key={rareKey}>
            rare ✦
          </div>
        )}

        {phase === "free" && padEmpty && flow !== "" && <div className="done">다 비웠다.</div>}

        <div className="bottom">
          {phase === "free" && nextPad && (emptied >= 0.68 || padEmpty) && (
            <NextPanel pad={nextPad} emphasis={padEmpty ? 1 : 0} gated={gated} />
          )}
          {phase === "free" && padEmpty && flow === "ready" && nextPad && !gated && (
            <button className="btn" onClick={openNext}>
              다음 패드 열기
            </button>
          )}
          {phase === "free" && padEmpty && flow === "ready" && nextPad && gated && (
            <div className="gate">
              <button className="btn" onClick={openWithReward} disabled={watching}>
                {watching ? "잠깐…" : "지금 열기"}
                <small>광고 1회</small>
              </button>
              <button className="link" onClick={openLater}>
                나중에
              </button>
            </div>
          )}
          {phase === "free" && showChallenge && !padEmpty && (
            <button className="btn" onClick={start}>
              30초 도전
            </button>
          )}
          {phase === "result" && result && <Result data={result} onAgain={start} onFree={goFree} />}
        </div>
      </div>
    </div>
  );
}

function Result({
  data,
  onAgain,
  onFree,
}: {
  data: { r: ChallengeResult; isBest: boolean; best: ChallengeResult | null };
  onAgain: () => void;
  onFree: () => void;
}) {
  const { r, isBest, best } = data;
  const n = useCountUp(r.score);
  const done = n === r.score;
  return (
    <div className="result">
      <div className="big">
        {n}
        <small>개 뽑았다</small>
      </div>
      <div className={"best" + (isBest ? " new" : "")}>
        {isBest ? "NEW BEST" : `BEST ${best?.score ?? r.score}`}
      </div>
      <div className="meta" style={{ opacity: done ? 1 : 0, transition: "opacity .4s" }}>
        {r.rare > 0 && <>희귀 {r.rare} · </>}
        최고 콤보 {r.bestCombo}
        {r.pulled !== r.score && <> · {r.pulled}개 뽑음</>}
      </div>
      <div className="row">
        <button className="btn" onClick={onAgain}>
          다시 30초
        </button>
        <button className="link" onClick={onFree}>
          그냥 뽑기
        </button>
      </div>
    </div>
  );
}
