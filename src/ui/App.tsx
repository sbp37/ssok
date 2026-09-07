import { useEffect, useRef, useState } from "react";
import { Game } from "../game/Game";
import type { ChallengeResult } from "../game/modes/Challenge";
import { haptics } from "../game/haptics";
import { sfx } from "../game/audio/Sfx";
import { useCountUp } from "./useCountUp";
import { NextPanel } from "./NextPanel";
import type { PadType } from "../game/pads/PadTypes";
import { DiamondSheet, TodaySheet, TreasureSheet } from "./Sheets";

interface Toast {
  id: number;
  text: string;
  sub?: string;
  tone: "rare" | "hidden" | "ultra" | "diamond";
}
/** the 30s challenge stays in the code but off the main screen (?challenge=1 shows it) */
const SHOW_CHALLENGE = new URLSearchParams(location.search).has("challenge");

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
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [sheet, setSheet] = useState<"" | "treasure" | "diamond" | "today">("");
  const [diamondCount, setDiamondCount] = useState(0);
  const [boxPulse, setBoxPulse] = useState(0);
  /** the "이 패드 안에 처음 보는 게 있어" hint, offered once per pad at ~68% */
  const [hint, setHint] = useState<"" | "offer" | "used">("");
  const toastId = useRef(0);
  const pushToast = (t: Omit<Toast, "id">) => {
    const id = ++toastId.current;
    setToasts((ts) => [...ts.slice(-2), { ...t, id }]);
    const tm = window.setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), t.tone === "ultra" ? 2600 : 1700);
    timers.current.push(tm);
  };

  useEffect(() => {
    const canvas = canvasRef.current!;
    const game = new Game(canvas);
    gameRef.current = game;
    (window as unknown as { __ssok?: Game }).__ssok = game;
    const offs = [
      game.on("pop", ({ pulled, combo, rare }) => {
        setPulled(pulled);
        setCombo(combo);
        void rare; // rares announce themselves when they land in the treasure box
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
        setGated(game.nextIsRare);
        // hold the empty pad for a beat, then say it quietly, then offer the door
        const t1 = window.setTimeout(() => setFlow("done"), 550);
        const t2 = window.setTimeout(() => setFlow("ready"), 1550);
        timers.current.push(t1, t2);
      }),
      game.on("progress", ({ emptied }) => {
        setEmptied(emptied);
        if (emptied >= 0.68) {
          setNextPad(game.nextPad);
          // only offer the peek when there is something in there nobody has seen yet
          setHint((h) => (h === "" && game.hiddenInfo?.isNew ? "offer" : h));
        }
      }),
      game.on("padChange", () => {
        setEmptied(0);
        setPadEmpty(false);
        setFlow("");
        setNextPad(null);
        setHint("");
      }),
      game.on("treasure", ({ type, kind, isNew, count, padName }) => {
        setBoxPulse((n) => n + 1);
        if (kind === "ultra") pushToast({ tone: "ultra", text: "뭐야 이거?", sub: `${isNew ? "NEW ✦ " : ""}${type.name}` });
        else if (kind === "hidden") pushToast({ tone: "hidden", text: `${padName} 속 ${type.name} 발견`, sub: isNew ? "처음 발견했어 ✦" : `+1 · 모두 ${count}개` });
        else pushToast({ tone: "rare", text: isNew ? `NEW ✦ ${type.name}` : `${type.name} +1`, sub: isNew ? "레어 발견 ✦" : undefined });
      }),
      game.on("diamond", ({ mission, diamonds }) => {
        setDiamondCount(diamonds);
        pushToast({ tone: "diamond", text: "💎 +1", sub: mission.label });
      }),
    ];
    setNextPad(null);
    setDiamondCount(game.diamonds.diamonds);
    const unsubD = game.diamonds.subscribe(() => setDiamondCount(game.diamonds.diamonds));
    offs.push(unsubD);
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
  /** a rare variant is passing: "광고 보고 잡기" → (mock) rewarded → open it. "그냥 다음" → the plain pad. */
  const catchRare = async () => {
    const g = gameRef.current;
    if (!g || watching) return;
    setWatching(true);
    const ok = await g.rewarded.watch();
    setWatching(false);
    if (ok) g.openPad(g.nextPad, { viaAd: true });
    else g.openNextPlain();
  };
  const skipRare = () => gameRef.current?.openNextPlain();
  /** hint hook: peek at the buried object after a (mock) ad – or just keep pulling */
  const peekWithAd = async () => {
    const g = gameRef.current;
    if (!g || watching) return;
    setWatching(true);
    const ok = await g.rewarded.watch();
    setWatching(false);
    setHint("used");
    if (ok) {
      g.diamonds.noteAdWatched();
      g.peekHidden();
    }
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
          <div className="right">
            <div className="toggles top">
              <button className="pill" onClick={() => setSheet("diamond")} aria-label="내 다이아">
                💎 {diamondCount}
              </button>
              <button className={"pill" + (boxPulse ? " pulse" : "")} key={boxPulse} onClick={() => setSheet("treasure")}>
                보물함
              </button>
              <button className="pill" onClick={() => setSheet("today")}>
                오늘
              </button>
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
        </div>

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

        {phase === "free" && hint === "offer" && !padEmpty && (
          <div className="hint-hook">
            <span>이 패드 안에 처음 보는 게 있어</span>
            <button className="mini" onClick={peekWithAd} disabled={watching}>
              {watching ? "잠깐…" : "광고 보고 살짝 보기"}
            </button>
            <button className="mini ghost" onClick={() => setHint("used")}>
              그냥 뽑기
            </button>
          </div>
        )}

        {phase === "intro" && <div className={"hint" + (hintHidden ? " hide" : "")}>하나 뽑아봐.</div>}

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
              <button className="btn" onClick={catchRare} disabled={watching}>
                {watching ? "잠깐…" : "광고 보고 잡기"}
                <small>희귀 패드</small>
              </button>
              <button className="link" onClick={skipRare}>
                그냥 다음
              </button>
            </div>
          )}
          {phase === "free" && SHOW_CHALLENGE && showChallenge && !padEmpty && (
            <button className="btn" onClick={start}>
              30초 도전
            </button>
          )}
          {phase === "result" && result && <Result data={result} onAgain={start} onFree={goFree} />}
        </div>
      </div>
      {sheet === "treasure" && gameRef.current && <TreasureSheet game={gameRef.current} onClose={() => setSheet("")} />}
      {sheet === "diamond" && gameRef.current && <DiamondSheet game={gameRef.current} onClose={() => setSheet("")} />}
      {sheet === "today" && gameRef.current && <TodaySheet game={gameRef.current} onClose={() => setSheet("")} />}
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
