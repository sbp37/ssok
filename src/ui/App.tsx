import { useEffect, useRef, useState } from "react";
import { TossAds } from "@apps-in-toss/web-framework";
import { Game } from "../game/Game";
import { preloadBeadAssets } from "../game/beads/BeadAssets";
import { sfx } from "../game/audio/Sfx";
import { haptics } from "../game/haptics";
import { NextPanel, type NextView } from "./NextPanel";
import { CollectionSheet, SettingsSheet } from "./Sheets";
import { AD_GROUP_IDS, AdPolicy, createAdProvider } from "../game/ads/AdPolicy";
import { OfferStats, pickOffer, type Offer } from "../game/ads/Offers";
import { PromotionRewards } from "../game/rewards/PromotionRewards";
import { PADS, type PadType } from "../game/pads/PadTypes";
import { PadSilhouette } from "./NextPanel";
import { useShare } from "./share";

interface Toast {
  id: number;
  text: string;
  sub?: string;
  tone: "rare" | "hidden" | "ultra" | "soft";
}

type Phase = "intro" | "free";
type SheetName = "" | "collection" | "settings";

const SHEET_HISTORY_KEY = "__ssokSheet";
/** how long a rewarded try that did not pay out keeps its line on screen */
const AD_MISS_TOAST = { tone: "soft", text: "광고를 불러오지 못했어", sub: "잠시 뒤 다시 해 봐" } as const;

/**
 * The bottom banner. Attached only while nothing covers it (loading card,
 * sheets). A no-fill folds the slot away; the next pad (`retryKey`) tries again
 * instead of giving the banner up for the whole session.
 */
function BannerAd({ hidden, retryKey }: { hidden: boolean; retryKey: number }) {
  const targetRef = useRef<HTMLDivElement>(null);
  const qa = import.meta.env.DEV && new URLSearchParams(location.search).has("bannerQa");
  const [supported, setSupported] = useState(qa);
  const [initialized, setInitialized] = useState(false);
  const [noFill, setNoFill] = useState(false);

  useEffect(() => {
    if (qa) return;
    let available = false;
    try {
      available = TossAds.initialize.isSupported();
    } catch {
      // A normal browser has no Toss ad host.
    }
    setSupported(available);
    if (!available) return;
    try {
      TossAds.initialize({
        callbacks: {
          onInitialized: () => setInitialized(true),
          onInitializationFailed: () => setSupported(false),
        },
      });
    } catch {
      setSupported(false);
    }
  }, [qa]);

  // a new pad: a folded banner may try again
  useEffect(() => setNoFill(false), [retryKey]);

  useEffect(() => {
    if (qa || !supported || !initialized || hidden || noFill || !targetRef.current) return;
    let attached: { destroy(): void } | null = null;
    try {
      attached = TossAds.attachBanner(AD_GROUP_IDS.banner, targetRef.current, {
        theme: "light",
        tone: "grey",
        variant: "expanded",
        callbacks: {
          onNoFill: () => setNoFill(true),
          onAdFailedToRender: () => setNoFill(true),
        },
      });
    } catch {
      setNoFill(true);
    }
    return () => attached?.destroy();
  }, [hidden, initialized, noFill, qa, supported]);

  if (!supported || noFill) return null;
  return (
    <div className={"ad-slot" + (hidden ? " hidden" : "")} aria-hidden="true">
      <div ref={targetRef} className="ad-slot-target" />
      {qa && <div className="ad-slot-qa">배너 미리보기</div>}
    </div>
  );
}

/**
 * The whole UI: a count, one treasure-box button, a tiny settings button, the
 * NEXT tease, and the door to the next pad. The pad is the screen.
 */
export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const timers = useRef<number[]>([]);
  const completionTimer = useRef<number | undefined>(undefined);
  const padTitleTimer = useRef<number | undefined>(undefined);
  const ads = useRef<AdPolicy | null>(null);
  const promotions = useRef<PromotionRewards | null>(null);
  const offerStats = useRef<OfferStats | null>(null);
  const transitioning = useRef(false);
  /** name of the treasure planted by "심기", announced when that pad opens */
  const planted = useRef<string | null>(null);
  const [phase, setPhase] = useState<Phase>("intro");
  const [hintHidden, setHintHidden] = useState(false);
  const [pulled, setPulled] = useState(0);
  const [padEmpty, setPadEmpty] = useState(false);
  // pad flow
  const [emptied, setEmptied] = useState(0);
  const [next, setNext] = useState<NextView | null>(null);
  /** "" → playing · "done" → "다 비웠다." · "ready" → the open button */
  const [flow, setFlow] = useState<"" | "done" | "ready">("");
  const [watching, setWatching] = useState(false);
  /** the one rewarded door for this completion */
  const [offer, setOffer] = useState<Offer | null>(null);
  /** "고르기" earned: three pads to pick from */
  const [choices, setChoices] = useState<PadType[] | null>(null);
  /** "살짝 보기": offered once per pad when something never found is buried */
  const [peek, setPeek] = useState<"" | "ready" | "used">("");
  /** is a rewarded ad loaded right now – a door is only shown when it can open */
  const [rewardReady, setRewardReady] = useState(false);
  /** bumps on every pad change (the banner retries after a no-fill) */
  const [padSerial, setPadSerial] = useState(0);
  // finds
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [boxPulse, setBoxPulse] = useState<{ n: number; strong: boolean }>({ n: 0, strong: false });
  const [glimmer, setGlimmer] = useState(false);
  const [sheet, setSheet] = useState<SheetName>("");
  const [collLabel, setCollLabel] = useState("컬렉션");
  const [loading, setLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(8);
  const [padTitle, setPadTitle] = useState("");
  const [tactileHint, setTactileHint] = useState<string | null>(null);
  const toastId = useRef(0);
  /** last pop or touch; a long quiet spell mid-pad shows a gesture hint on something pullable */
  const lastActivity = useRef(performance.now());
  const [stuck, setStuck] = useState<{ x: number; y: number; kind: string; n: number } | null>(null);
  const { busy: shareBusy, share } = useShare((text) => pushToast({ tone: "soft", text }));

  const later = (fn: () => void, ms: number) => {
    const t = window.setTimeout(fn, ms);
    timers.current.push(t);
  };
  const pushToast = (t: Omit<Toast, "id">) => {
    const id = ++toastId.current;
    setToasts((ts) => [...ts.slice(-1), { ...t, id }]);
    later(() => setToasts((ts) => ts.filter((x) => x.id !== id)), t.tone === "ultra" ? 2600 : t.tone === "soft" ? 1500 : 1700);
  };
  const showPadTitle = (name: string) => {
    window.clearTimeout(padTitleTimer.current);
    setPadTitle(`${name} 패드`);
    padTitleTimer.current = window.setTimeout(() => setPadTitle(""), 1900);
    timers.current.push(padTitleTimer.current);
  };

  useEffect(() => {
    const canvas = canvasRef.current!;
    const started = performance.now();
    later(() => setLoadingProgress(46), 90);
    later(() => setLoadingProgress(78), 220);
    // give the photo beads up to 350ms to arrive so the first pad is drawn once, in its final look
    let game: Game | null = null;
    let cancelled = false;
    const offs: (() => void)[] = [];
    void Promise.race([preloadBeadAssets(), new Promise<void>((r) => setTimeout(r, 350))]).then(() => {
      if (cancelled) return;
      game = new Game(canvas);
      ads.current = new AdPolicy(createAdProvider());
      promotions.current = new PromotionRewards();
      offerStats.current = new OfferStats();
      (window as unknown as { __ssokAds?: OfferStats }).__ssokAds = offerStats.current;
      gameRef.current = game;
      offs.push(...bind(game));
      // just long enough that the card never flashes; the game is already live underneath
      const wait = Math.max(0, 380 - (performance.now() - started));
      later(() => setLoadingProgress(100), wait);
      later(() => {
        setLoading(false);
        if (game) showPadTitle(game.pad.name);
      }, wait + 160);
    });
    return () => {
      cancelled = true;
      ads.current?.cancel();
      ads.current = null;
      promotions.current = null;
      offs.forEach((off) => off());
      timers.current.forEach((t) => window.clearTimeout(t));
      game?.destroy();
      gameRef.current = null;
    };
  }, []);

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const next = event.state?.[SHEET_HISTORY_KEY];
      setSheet(next === "collection" || next === "settings" ? next : "");
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // stuck? after a quiet spell (shorter before the very first pull) show how to take the next one.
  // Any touch hides it again; it never repeats faster than the quiet spell itself.
  useEffect(() => {
    if (loading || padEmpty || sheet) {
      setStuck(null);
      return;
    }
    const quiet = phase === "intro" ? 4500 : 8000;
    const t = window.setInterval(() => {
      const g = gameRef.current;
      if (!g || performance.now() - lastActivity.current < quiet) return;
      lastActivity.current = performance.now();
      const h = g.stuckHint(phase === "intro");
      if (h) setStuck((p) => ({ ...h, n: (p?.n ?? 0) + 1 }));
    }, 500);
    return () => window.clearInterval(t);
  }, [loading, padEmpty, sheet, phase]);

  // a door is only offered while its ad is actually loaded; re-checked while one could be shown
  useEffect(() => {
    if (!(padEmpty && flow === "ready") && peek !== "ready") return;
    const tick = () => setRewardReady(ads.current?.ready("rewarded") ?? false);
    tick();
    const t = window.setInterval(tick, 1000);
    return () => window.clearInterval(t);
  }, [padEmpty, flow, peek]);

  const openSheet = (next: Exclude<SheetName, "">) => {
    if (!sheet) {
      window.history.pushState({ ...window.history.state, [SHEET_HISTORY_KEY]: next }, "");
    } else {
      window.history.replaceState({ ...window.history.state, [SHEET_HISTORY_KEY]: next }, "");
    }
    setSheet(next);
  };

  const closeSheet = () => {
    if (window.history.state?.[SHEET_HISTORY_KEY]) window.history.back();
    else setSheet("");
  };

  /** wire the game's events to the UI; returns the unsubscribers */
  const bind = (game: Game): (() => void)[] => {
    (window as unknown as { __ssok?: Game }).__ssok = game;
    // a returning player does not need "하나 뽑아봐." again
    if (game.progressStore.totalCompleted > 0) {
      setPhase("free");
      setHintHidden(true);
    }
    const label = () => {
      const n = game.progressStore.discoveredPads.length;
      setCollLabel(n > 0 && n < PADS.length ? `컬렉션 ${n}/${PADS.length}` : "컬렉션");
    };
    label();
    // a new day: one quiet line, and the first pad is a touch more generous. No streaks, no stamps.
    if (game.progressStore.newDay) later(() => pushToast({ tone: "soft", text: "오늘은 뭔가 좀 다르다. ✦" }), 900);
    promotions.current?.onVisit(game.progressStore.newDay, game.progressStore.totalCompleted);
    // AIT QA bundles use TEST_ codes, so opening the ordinary console test
    // push is enough to verify every promotion without a custom deep link.
    if (promotions.current?.mode === "test") {
      later(() => {
        void promotions.current?.runTestMilestones().then((granted) => {
          if (granted?.includes("returnVisit")) {
            pushToast({ tone: "soft", text: "재방문 보상 테스트 완료", sub: "2원" });
          }
        });
      }, 900);
    }
    const offs = [
      game.progressStore.subscribe(label),
      // pin set / cleared in the collection: the NEXT line follows at once
      game.treasure.subscribe(() => setNext((n) => (n ? game.nextInfo : n))),
      game.on("pop", ({ pulled }) => {
        lastActivity.current = performance.now();
        setStuck(null);
        setPulled(pulled);
        setPadEmpty(false);
      }),
      game.on("tactileHint", ({ text }) => setTactileHint(text)),
      game.on("firstPop", () => {
        setHintHidden(true);
        setPhase("free");
      }),
      game.on("padEmpty", () => {
        promotions.current?.onPadCompleted(game.progressStore.totalCompleted);
        setPadEmpty(true);
        const info = game.nextInfo;
        setNext(info);
        const o = pickOffer({
          nextTier: info.tier,
          hadTreasure: game.hadTreasure,
          bonus: game.isBonus,
          nextBase: info.pad.variantOf ?? info.pad.id,
          found: (id) => game.treasure.has(id),
          totalCompleted: game.progressStore.totalCompleted,
        });
        setOffer(o);
        offerStats.current?.note("offered", o.kind);
        // hold the empty pad (and the full jar) for a beat, say it quietly, then offer the door
        setFlow("done");
        window.clearTimeout(completionTimer.current);
        // Finale stars last 1.15s: never invite an ad before that gesture ends.
        completionTimer.current = window.setTimeout(() => setFlow("ready"), 1200);
        timers.current.push(completionTimer.current);
      }),
      game.on("progress", ({ emptied }) => {
        setEmptied(emptied);
        if (emptied >= 0.68) {
          setNext(game.nextInfo);
          // a passive nudge, once, when something unseen is still buried in there
          setGlimmer((g) => {
            if (g) return g;
            const info = game.hiddenInfo;
            // the opening pads stay ad-free; later, a never-found treasure gets the one in-round door
            if (info && info.isNew && game.progressStore.totalCompleted >= 2) {
              later(() => setGlimmer(false), 2600);
              // the one in-round door: show it clearly for a moment, for an ad
              setPeek((p) => (p === "" ? "ready" : p));
              return true;
            }
            return g;
          });
        }
      }),
      game.on("padChange", ({ pad, newPad, newVariant, bonus }) => {
        window.clearTimeout(completionTimer.current);
        setEmptied(0);
        setPadEmpty(false);
        setFlow("");
        setNext(null);
        setOffer(null);
        setChoices(null);
        setPeek("");
        setGlimmer(false);
        setPadSerial((n) => n + 1);
        showPadTitle(bonus ? "보너스" : pad.name);
        // first time on this pad (or this variant): a small line after it appears. Seen before: nothing.
        if (newPad || newVariant) later(() => pushToast({ tone: "soft", text: "NEW ✦", sub: pad.name }), 450);
        else if (bonus) later(() => pushToast({ tone: "soft", text: "보물 하나, 어딘가에" }), 450);
        if (planted.current) {
          const name = planted.current;
          planted.current = null;
          later(() => pushToast({ tone: "hidden", text: `${name}, 어딘가에 묻어 뒀어` }), newPad || newVariant ? 2100 : 450);
        }
      }),
      game.on("treasure", ({ type, kind, isNew, count, padName, targetHit, setDone, shelved }) => {
        // a repeat rare only makes the box blink; new things and buried things get a short line
        setBoxPulse((p) => ({ n: p.n + 1, strong: kind !== "rare" || isNew }));
        const firstLine = targetHit ? "찾던 보물이다! 📍" : shelved ? "처음 발견했어 ✦ 진열장에 놓았어" : "처음 발견했어 ✦";
        if (kind === "ultra") pushToast({ tone: "ultra", text: "뭐야 이거?", sub: `${isNew ? "NEW ✦ " : ""}${type.name}` });
        else if (kind === "hidden") pushToast({ tone: "hidden", text: `${padName} 속 ${type.name} 발견`, sub: isNew ? firstLine : `+1 · 모두 ${count}개` });
        else if (isNew) pushToast({ tone: "rare", text: `NEW ✦ ${type.name}`, sub: targetHit || shelved ? firstLine : undefined });
        if (setDone) later(() => pushToast({ tone: "ultra", text: `세트 완성 ✦ ${setDone}`, sub: "컬렉션에서 볼 수 있어" }), 1400);
      }),
    ];
    return offs;
  };

  /** the plain door: an interstitial (when due), then the next pad – a passing variant is let go */
  const openNext = async () => {
    const g = gameRef.current;
    const policy = ads.current;
    if (!g || !policy || transitioning.current || flow !== "ready" || !padEmpty) return;
    transitioning.current = true;
    setWatching(true);
    sfx.unlock();
    const current = g.pad;
    sfx.pause("ad");
    try {
      const result = await policy.next("interstitial", g.progressStore.totalCompleted);
      if (result === null || gameRef.current !== g || g.pad !== current) return;
      g.openNextPlain();
    } finally {
      sfx.unpause("ad");
      transitioning.current = false;
      if (gameRef.current === g) setWatching(false);
    }
  };

  /** the rewarded door: only the SDK's earned-reward event opens anything beyond the plain next pad */
  const takeOffer = async () => {
    const g = gameRef.current;
    const policy = ads.current;
    const o = offer;
    if (!g || !policy || !o || transitioning.current || flow !== "ready" || !padEmpty) return;
    transitioning.current = true;
    setWatching(true);
    sfx.unlock();
    offerStats.current?.note("taken", o.kind);
    const current = g.pad;
    sfx.pause("ad");
    try {
      const result = await policy.next("rewarded", g.progressStore.totalCompleted);
      if (result === null || gameRef.current !== g || g.pad !== current) return;
      if (result !== "rewarded") {
        // no reward: stay on this screen – the player chose a door, never swap it for another silently
        if (result === "unavailable") {
          pushToast(AD_MISS_TOAST);
          policy.waive(g.progressStore.totalCompleted); // no interstitial on top of a failed door
        }
        else pushToast({ tone: "soft", text: "끝까지 보면 받을 수 있어" });
        setRewardReady(policy.ready("rewarded"));
        return;
      }
      offerStats.current?.note("earned", o.kind);
      if (o.kind === "rare") g.openPad(g.nextPad);
      else if (o.kind === "dig") g.openBonusPad();
      else if (o.kind === "seek" && o.seekId) {
        g.plantNext(o.seekId);
        planted.current = o.seekName ?? null;
        g.openPad(g.nextPad);
      } else setChoices(g.nextChoices());
    } finally {
      sfx.unpause("ad");
      transitioning.current = false;
      if (gameRef.current === g) setWatching(false);
    }
  };
  const choosePad = (pad: PadType) => {
    const g = gameRef.current;
    if (!g || !choices) return;
    haptics.press();
    setChoices(null);
    g.openPad(pad);
  };

  /** mid-round: an ad for a clear look at what is buried. Never replaces the NEXT ad. */
  const takePeek = async () => {
    const g = gameRef.current;
    const policy = ads.current;
    if (!g || !policy || peek !== "ready" || transitioning.current || padEmpty) return;
    transitioning.current = true;
    setWatching(true);
    sfx.unlock();
    offerStats.current?.note("taken", "peek");
    const current = g.pad;
    sfx.pause("ad");
    try {
      const result = await policy.next("rewarded", g.progressStore.totalCompleted);
      if (result === null || gameRef.current !== g || g.pad !== current) return;
      if (result === "rewarded") {
        offerStats.current?.note("earned", "peek");
        setPeek("used");
        // worth an ad: it stays visible until this pad is done, not for a blink
        g.peekHidden(Infinity);
        pushToast({ tone: "hidden", text: "여기 있다 ✦", sub: "이 판이 끝날 때까지 보여 줄게" });
      } else if (result === "unavailable") {
        setPeek("used"); // no fill: do not leave a dead button
        pushToast(AD_MISS_TOAST);
      }
    } finally {
      sfx.unpause("ad");
      transitioning.current = false;
      if (gameRef.current === g) setWatching(false);
    }
  };

  return (
    <div className="stage">
      <div
        className="playfield"
        onPointerDownCapture={() => {
          lastActivity.current = performance.now();
          setStuck(null);
        }}
      >
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
                onClick={() => {
                  haptics.press();
                  openSheet("collection");
                }}
              >
                {collLabel}
              </button>
              <button
                className="pill tiny"
                onClick={() => {
                  haptics.press();
                  openSheet("settings");
                }}
                aria-label="설정"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M19.4 13a7.7 7.7 0 0 0 .05-1 7.7 7.7 0 0 0-.05-1l2.05-1.6-2-3.46-2.5 1a7.5 7.5 0 0 0-1.73-1L14.84 3h-4l-.38 2.94a7.5 7.5 0 0 0-1.73 1l-2.5-1-2 3.46L6.28 11a7.7 7.7 0 0 0-.05 1 7.7 7.7 0 0 0 .05 1l-2.05 1.6 2 3.46 2.5-1a7.5 7.5 0 0 0 1.73 1l.38 2.94h4l.38-2.94a7.5 7.5 0 0 0 1.73-1l2.5 1 2-3.46L19.4 13Zm-6.56 2.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z" />
                </svg>
              </button>
            </div>
          </div>

          {padTitle && <div className="pad-title" role="status">{padTitle}</div>}

          {phase === "intro" && (
            <div className={"hint" + (hintHidden ? " hide" : "")} role="status">
              <strong>하나 뽑아봐.</strong>
              <small>소리를 켜고 들어보세요</small>
            </div>
          )}
          {phase === "free" && padEmpty && flow !== "" && (
            <div className="done">
              <div role="status">
                <strong>쏙, 다 비웠다!</strong>
                <small>{gameRef.current?.pad.name} 패드 완성</small>
              </div>
              {flow === "ready" && (
                <button
                  className="done-share"
                  disabled={shareBusy}
                  onClick={() => {
                    haptics.press();
                    void share(gameRef.current?.pad.name);
                  }}
                >
                  {shareBusy ? "잠깐…" : "자랑하기 ↗"}
                </button>
              )}
            </div>
          )}
          {phase === "free" && glimmer && !padEmpty && <div className="glimmer">안쪽에서 뭔가 반짝인다…</div>}
          {phase === "free" && peek === "ready" && rewardReady && !padEmpty && (
            <button className="peek" onClick={takePeek} disabled={watching}>
              {watching ? "잠깐…" : "광고 보고 살짝 보기"}
            </button>
          )}
          {tactileHint && !padEmpty && !glimmer && <div className="tactile-hint" role="status">{tactileHint}</div>}

          {stuck && !padEmpty && (
            <img
              key={stuck.n}
              className="stuck-hint"
              src={`${import.meta.env.BASE_URL}hints/hint-${stuck.kind}.svg`}
              style={{ left: stuck.x, top: stuck.y }}
              alt=""
              aria-hidden="true"
            />
          )}
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
            {phase === "free" && next && (emptied >= 0.68 || padEmpty) && <NextPanel info={next} emphasis={padEmpty ? 1 : 0} reveal={padEmpty ? 1 : Math.max(0, Math.min(1, (emptied - 0.5) / 0.4))} />}
            {phase === "free" && padEmpty && flow === "ready" && next && choices && (
              <div className="choices" role="group" aria-label="다음 패드 고르기">
                {choices.map((p) => (
                  <button key={p.id} className="choice" onClick={() => choosePad(p)}>
                    <PadSilhouette pad={p} size={52} mode="color" glint={false} />
                    <span>{p.name}</span>
                  </button>
                ))}
              </div>
            )}
            {phase === "free" && padEmpty && flow === "ready" && next && !choices && (
              <div className="gate">
                {offer && rewardReady && (
                  <button className="btn" onClick={takeOffer} disabled={watching}>
                    {watching ? "잠깐…" : offer.title}
                    <small>{offer.sub}</small>
                  </button>
                )}
                <button className={offer && rewardReady ? "btn ghost" : "btn"} onClick={openNext} disabled={watching}>
                  {watching && !(offer && rewardReady) ? "잠깐…" : offer?.kind === "rare" && rewardReady ? "그냥 다음" : "다음 패드 열기"}
                </button>
              </div>
            )}
          </div>
        </div>
        {sheet === "collection" && gameRef.current && <CollectionSheet game={gameRef.current} onClose={closeSheet} />}
        {sheet === "settings" && <SettingsSheet onClose={closeSheet} />}
      </div>
      <BannerAd hidden={sheet !== "" || loading} retryKey={padSerial} />
      {loading && (
        <div className="loading-screen" role="status" aria-live="polite" aria-busy="true">
          <div className="loading-card">
            <div className="loading-icon">
              <img src={`${import.meta.env.BASE_URL}branding/app-icon-180.png`} alt="" width={86} height={86} />
              <i className="loading-spark one" />
              <i className="loading-spark two" />
            </div>
            <div className="loading-kicker">힐링 미니앱</div>
            <h1>쏙: 피키패드</h1>
            <p>말랑한 젤 속 보석을 만나는 중</p>
            <div className="loading-bar" aria-label={`로딩 ${loadingProgress}%`}>
              <span style={{ width: `${loadingProgress}%` }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
