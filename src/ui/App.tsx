import { useEffect, useRef, useState } from "react";
import { TossAds } from "@apps-in-toss/web-framework";
import { Game } from "../game/Game";
import { preloadBeadAssets } from "../game/beads/BeadAssets";
import { sfx } from "../game/audio/Sfx";
import { haptics } from "../game/haptics";
import { NextPanel, type NextView } from "./NextPanel";
import { BeadIcon, CollectionSheet, SettingsSheet } from "./Sheets";
import { AD_GROUP_IDS, AdPolicy, createAdProvider } from "../game/ads/AdPolicy";
import { OfferStats, pickOffer, seekTitle, type Offer } from "../game/ads/Offers";
import { PromotionRewards } from "../game/rewards/PromotionRewards";
import { PADS, type PadType } from "../game/pads/PadTypes";
import { activeTheme } from "../game/rewards/themes";
import { PadSilhouette } from "./NextPanel";
import { useShare } from "./share";
import type { AdHook } from "./Bracelet";
import { RELEASE } from "../game/release";
import { backupNow, backupSoon, restoreBackup } from "../game/backup";
import { track } from "../game/analytics";
import { today } from "../game/pads/progress";
import { CARD_SIZE } from "../game/rewards/daily";
import { TREASURE_TYPES } from "../game/rewards/treasure";
import { daysLeft, dDay } from "../game/rewards/themes";

interface Toast {
  id: number;
  text: string;
  sub?: string;
  tone: "rare" | "hidden" | "ultra" | "soft";
}

type Phase = "intro" | "free";
type SheetName = "" | "collection" | "settings";

const SHEET_HISTORY_KEY = "__ssokSheet";
const TOMORROW_KEY = "ssok.tomorrow.v1";
const THEME_SEEN_KEY = "ssok.theme.v1";
/** "가을 숲 테마 ✦" once per theme per year, for players past the opening */
function takeThemeLine(): { name: string; until: string } | null {
  const t = activeTheme();
  if (!t) return null;
  const tag = `${t.id}-${new Date().getFullYear()}`;
  try {
    if (localStorage.getItem(THEME_SEEN_KEY) === tag) return null;
    localStorage.setItem(THEME_SEEN_KEY, tag);
  } catch {
    return null;
  }
  return { name: t.name, until: t.until };
}
const SEASON_KEY = "ssok.season.v1";
/** the last week of a theme with treasures still missing: one line a day */
function takeSeasonLine(missing: number): { name: string; days: number } | null {
  const t = activeTheme();
  if (!t || missing <= 0) return null;
  const days = daysLeft(t);
  if (days > 7) return null;
  try {
    if (localStorage.getItem(SEASON_KEY) === today()) return null;
    localStorage.setItem(SEASON_KEY, today());
  } catch {
    return null;
  }
  return { name: t.name, days };
}
const typeName = (id: string) => TREASURE_TYPES.find((t) => t.id === id)?.name ?? "보물";
/** true the first time only (a one-off hint); storage errors skip it */
function takeOnce(key: string) {
  try {
    if (localStorage.getItem(key)) return false;
    localStorage.setItem(key, "1");
    return true;
  } catch {
    return false;
  }
}
/** completions worth a funnel step of their own */
const FUNNEL = new Set([1, 2, 3, 5, 10, 20]);

/** pads emptied this session before the "come back tomorrow" line (once a day) */
const TOMORROW_AFTER = 3;
const localDay = () => {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};
/** true once per calendar day; storage errors simply skip the line */
function takeTomorrowLine() {
  try {
    if (localStorage.getItem(TOMORROW_KEY) === localDay()) return false;
    localStorage.setItem(TOMORROW_KEY, localDay());
    return true;
  } catch {
    return false;
  }
}
/** how long a rewarded try that did not pay out keeps its line on screen */
const AD_MISS_TOAST = { tone: "soft", text: "광고를 불러오지 못했어", sub: "잠시 뒤 다시 해 봐" } as const;

/** banner SDK start-ups tried (one per pad, after a failure) before giving up for the session */
const BANNER_INIT_TRIES = 3;

/**
 * The bottom banner. Attached only while nothing covers it (loading card,
 * sheets). Its slot keeps its height whatever happens – a no-fill or a failed
 * start-up leaves it empty instead of folding it, because folding resizes the
 * pad under the player's finger. The next pad (`retryKey`) tries again.
 */
function BannerAd({ hidden, retryKey }: { hidden: boolean; retryKey: number }) {
  const targetRef = useRef<HTMLDivElement>(null);
  const qa = import.meta.env.DEV && new URLSearchParams(location.search).has("bannerQa");
  const [supported, setSupported] = useState(qa);
  const [initialized, setInitialized] = useState(false);
  const [initFailures, setInitFailures] = useState(0);
  const initAttempts = useRef({ n: 0, key: -1 });
  const [noFill, setNoFill] = useState(false);

  useEffect(() => {
    if (qa) return;
    try {
      setSupported(TossAds.initialize.isSupported());
    } catch {
      // A normal browser has no Toss ad host.
    }
  }, [qa]);

  // start the SDK; after a failure, once more on a later pad – one attempt at a time, a few in all
  useEffect(() => {
    if (qa || !supported || initialized) return;
    const a = initAttempts.current;
    if (a.n > initFailures || a.n >= BANNER_INIT_TRIES || a.key === retryKey) return;
    a.n++;
    a.key = retryKey;
    try {
      TossAds.initialize({
        callbacks: {
          onInitialized: () => setInitialized(true),
          onInitializationFailed: () => setInitFailures((n) => n + 1),
        },
      });
    } catch {
      setInitFailures((n) => n + 1);
    }
  }, [qa, supported, initialized, initFailures, retryKey]);

  // a new pad: a banner that found no ad may try again
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

  if (!supported) return null;
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
  /** this pad already gave its free glimpse of a new treasure */
  const glimpsed = useRef(false);
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
  const sessionEmptied = useRef(0);
  /** last pop or touch; a long quiet spell mid-pad shows a gesture hint on something pullable */
  const lastActivity = useRef(performance.now());
  const [stuck, setStuck] = useState<{ x: number; y: number; kind: string; n: number } | null>(null);
  const { busy: shareBusy, share } = useShare(
    (text) => pushToast({ tone: "soft", text }),
    () => {
      track("share_done");
      // one plant ticket a day for a share (in-game only)
      if (gameRef.current?.daily.shared(today())) {
        track("ticket_from_share");
        pushToast({ tone: "hidden", text: "공유 고마워 ✦", sub: "심기권 1장 – 심기를 광고 없이" });
      }
    },
  );

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
    setPadTitle(name === "오늘의 젤" ? name : `${name} 패드`);
    padTitleTimer.current = window.setTimeout(() => setPadTitle(""), 1900);
    timers.current.push(padTitleTimer.current);
  };

  useEffect(() => {
    const canvas = canvasRef.current!;
    const started = performance.now();
    later(() => setLoadingProgress(46), 90);
    later(() => setLoadingProgress(78), 220);
    // give the photo beads up to 350ms to arrive so the first pad is drawn once, in its final look;
    // a wiped web view gets its save back from the native copy before anything reads it
    let game: Game | null = null;
    let cancelled = false;
    const offs: (() => void)[] = [];
    void Promise.all([
      Promise.race([preloadBeadAssets(), new Promise<void>((r) => setTimeout(r, 350))]),
      // a copy that only answers after the game started: restore it and start again
      restoreBackup(1500, () => location.reload()),
    ]).then(() => {
      if (cancelled) return;
      game = new Game(canvas);
      ads.current = new AdPolicy(createAdProvider());
      promotions.current = new PromotionRewards();
      offerStats.current = new OfferStats();
      if (!RELEASE) (window as unknown as { __ssokAds?: OfferStats }).__ssokAds = offerStats.current;
      gameRef.current = game;
      offs.push(...bind(game));
      // just long enough that the card never flashes; the game is already live underneath
      const wait = Math.max(0, 380 - (performance.now() - started));
      later(() => setLoadingProgress(100), wait);
      later(() => {
        setLoading(false);
        if (game) showPadTitle(game.isBonus ? "보너스" : game.isDaily ? "오늘의 젤" : game.pad.name);
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

  // leaving the app (home, another app, an ad's link): copy the save while we still can
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void backupNow();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
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
    if (!(padEmpty && flow === "ready")) return;
    const tick = () => setRewardReady(ads.current?.ready("rewarded") ?? false);
    tick();
    const t = window.setInterval(tick, 1000);
    return () => window.clearInterval(t);
  }, [padEmpty, flow]);

  /** a seek door is free while a ticket is in hand – read live: a share can bring one mid-screen */
  const isFree = (o: Offer | null) => o?.kind === "seek" && (gameRef.current?.daily.tickets ?? 0) > 0;
  /** the door on screen right now: a ticket needs no ad; every other door needs a loaded one */
  const doorShown =
    !!offer && (offer.kind === "choose" ? rewardReady && !!offer.alternatives?.length : isFree(offer) || rewardReady);
  const statKind = (o: Offer) => (isFree(o) ? "ticket" : o.kind);
  // a door counts as offered only once it is actually on screen (no loaded ad → no door)
  const offerSeen = useRef("");
  useEffect(() => {
    if (!(padEmpty && flow === "ready" && offer && doorShown && !sheet && !loading)) return;
    const tag = `${padSerial}:${offer.kind}`;
    if (offerSeen.current === tag) return;
    offerSeen.current = tag;
    offerStats.current?.note("offered", statKind(offer));
    track(`door_${statKind(offer)}_offer`);
  }, [padEmpty, flow, offer, doorShown, sheet, loading, padSerial]);

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
    // QA handle (`__ssok.debugFinishPad()` empties a pad) – never in a release bundle
    if (!RELEASE) (window as unknown as { __ssok?: Game }).__ssok = game;
    // a returning player does not need "하나 뽑아봐." again
    if (game.progressStore.totalCompleted > 0) {
      setPhase("free");
      setHintHidden(true);
    }
    const label = () => {
      // the everyday pads only – a limited theme pad is counted in its own section
      const n = game.progressStore.discoveredPads.filter((id) => PADS.some((p) => p.id === id)).length;
      setCollLabel(n > 0 && n < PADS.length ? `컬렉션 ${n}/${PADS.length}` : "컬렉션");
    };
    label();
    track("app_open", { completed: game.progressStore.totalCompleted, newDay: game.progressStore.newDay });
    if (game.bootOpenedDaily) track("daily_open");
    // a new day: today's gel is waiting (or already on the table)
    if (game.isDaily) later(() => pushToast({ tone: "hidden", text: "오늘의 젤 ✦", sub: "보물 하나 확정 · 오늘만" }), 900);
    else if (game.progressStore.newDay) later(() => pushToast({ tone: "soft", text: "새로운 하루 ✦", sub: "곧 오늘의 젤이 나와" }), 900);
    // a season's last week, treasures still missing: one line a day
    {
      const theme = activeTheme();
      const season = theme ? takeSeasonLine(theme.treasures.filter((id) => !game.treasure.has(id)).length) : null;
      if (season && theme) {
        const left = theme.treasures.filter((id) => !game.treasure.has(id)).length;
        later(() => pushToast({ tone: "hidden", text: `${season.name} ${dDay(season.days)} ✦`, sub: `한정 보물 ${left}개 남았어` }), 2600);
      }
    }
    // a new monthly theme: one line, after the opening pads (a first-time player has enough to read)
    if (game.progressStore.totalCompleted >= 3) {
      const theme = takeThemeLine();
      if (theme) later(() => pushToast({ tone: "hidden", text: `${theme.name} 테마 시작 ✦`, sub: `${theme.until} 한정 패드와 보물` }), 2200);
    }
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
      // midnight passed with the game open: the same as starting on a new day
      game.on("newDay", () => {
        later(() => pushToast({ tone: "soft", text: "새로운 하루 ✦", sub: "다음엔 오늘의 젤" }), 900);
        promotions.current?.onVisit(true, game.progressStore.totalCompleted);
      }),
      game.on("firstPop", () => {
        setHintHidden(true);
        setPhase("free");
      }),
      game.on("padEmpty", () => {
        const done = game.progressStore.totalCompleted;
        promotions.current?.onPadCompleted(done);
        backupSoon();
        track("pad_done", { completed: done, bonus: game.isBonus, daily: game.isDaily });
        if (!game.isBonus && FUNNEL.has(done) && game.progressStore.currentDone) track(`pad_done_${done}`);
        // a reason to come back, said once a day after a little play – and true: tomorrow's
        // first pad is today's gel, with a treasure for sure
        if (!game.isBonus && ++sessionEmptied.current === TOMORROW_AFTER && takeTomorrowLine()) {
          later(() => pushToast({ tone: "soft", text: "내일은 오늘의 젤 ✦", sub: "보물 하나 확정" }), 3200);
        }
        // enough beads for a bracelet and none made yet: say where, once
        if (!game.isBonus && !game.bracelets.bracelets.length && game.bracelets.spareTotal >= 16 && takeOnce("ssok.bracelet-hint.v1")) {
          later(() => pushToast({ tone: "hidden", text: "비즈가 모였어 ✦", sub: "컬렉션에서 팔찌를 만들어 봐" }), 4600);
        }
        // the day's stamp, once a day; seven make a plant ticket
        if (!game.isBonus) {
          const st = game.daily.stamp(today());
          if (st.stamped) {
            track(st.full ? "stamp_card_full" : `stamp_${st.n}`);
            later(
              () =>
                pushToast(
                  st.full
                    ? { tone: "ultra", text: "도장판 완성 ✦", sub: "심기권 1장 – 심기를 광고 없이" }
                    : { tone: "soft", text: `오늘의 도장 ${st.n}/${CARD_SIZE} ✦` },
                ),
              1700,
            );
          }
        }
        setPadEmpty(true);
        const info = game.nextInfo;
        setNext(info);
        // the dig names its sure treasure before the ad
        const digId = !game.hadTreasure && !game.isBonus ? game.rollBonusTreasure() : null;
        const o: Offer = pickOffer({
          nextTier: info.tier,
          hadTreasure: game.hadTreasure,
          bonus: game.isBonus,
          nextBase: info.pad.variantOf ?? info.pad.id,
          found: (id) => game.treasure.has(id),
          totalCompleted: done,
          pinned: game.treasure.target,
          tickets: game.daily.tickets,
          dig: digId ? { id: digId, name: typeName(digId) } : null,
        });
        // "다른 패드로": the alternatives are rolled once and shown before the ad
        if (o.kind === "choose") o.alternatives = game.nextChoices().slice(1);
        setOffer(o);
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
          // a never-found treasure: once a pad, a free, short glimpse of where it lies – a reason to dig on
          const info = game.hiddenInfo;
          if (!glimpsed.current && info && info.isNew && game.progressStore.totalCompleted >= 2) {
            glimpsed.current = true;
            setGlimmer(true);
            later(() => setGlimmer(false), 2600);
            game.peekHidden(1.8);
          }
        }
      }),
      game.on("padChange", ({ pad, newPad, newVariant, bonus, daily }) => {
        window.clearTimeout(completionTimer.current);
        glimpsed.current = false;
        setEmptied(0);
        setPadEmpty(false);
        setFlow("");
        setNext(null);
        setOffer(null);
        setGlimmer(false);
        setPadSerial((n) => n + 1);
        showPadTitle(bonus ? "보너스" : daily ? "오늘의 젤" : pad.name);
        if (daily) {
          track("daily_open");
          later(() => pushToast({ tone: "hidden", text: "오늘의 젤 ✦", sub: "보물 하나 확정 · 오늘만" }), newPad ? 2100 : 450);
        }
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
      if (result === "closed") track("ad_interstitial_shown");
      g.openNextPlain();
    } finally {
      sfx.unpause("ad");
      transitioning.current = false;
      if (gameRef.current === g) setWatching(false);
    }
  };

  /**
   * The door. A rewarded ad: only the SDK's earned-reward event opens anything beyond the plain
   * next pad. A plant ticket: no ad at all – the ticket is the price, and this transition's
   * interstitial is waived too, so "free" means free. `pick`: the pad chosen on "다른 패드로".
   */
  const takeOffer = async (pick?: PadType) => {
    const g = gameRef.current;
    const policy = ads.current;
    const o = offer;
    if (!g || !policy || !o || transitioning.current || flow !== "ready" || !padEmpty) return;
    if (o.kind === "choose" && !pick) return;
    const kind = statKind(o);
    if (isFree(o)) {
      // a second tap in the same frame still sees this screen's state: the game knows the pad already moved on
      if (!o.seekId || !g.progressStore.currentDone || !g.daily.useTicket()) return;
      haptics.press();
      offerStats.current?.note("taken", kind);
      offerStats.current?.note("earned", kind);
      track("door_ticket_take");
      track("door_ticket_earn");
      policy.waive(g.progressStore.totalCompleted);
      g.plantNext(o.seekId);
      planted.current = o.seekName ?? null;
      g.openPad(g.nextPad);
      return;
    }
    transitioning.current = true;
    setWatching(true);
    sfx.unlock();
    offerStats.current?.note("taken", kind);
    track(`door_${kind}_take`);
    const current = g.pad;
    // The reward is the player's at the SDK's earned event, before the ad closes: keep what a
    // restart can keep, so an ad that never closes (the app killed under it) loses nothing.
    const onEarned = () => {
      if (gameRef.current !== g || g.pad !== current) return;
      if (o.kind === "seek" && o.seekId) g.plantNext(o.seekId);
      else if (o.kind === "rare") g.catchNext();
      else if (o.kind === "dig") g.earnBonus(o.digId);
    };
    sfx.pause("ad");
    try {
      const result = await policy.next("rewarded", g.progressStore.totalCompleted, onEarned);
      if (result === null || gameRef.current !== g || g.pad !== current) return;
      if (result !== "rewarded") {
        track(`door_${kind}_${result}`);
        // no reward: stay on this screen – the player chose a door, never swap it for another silently
        if (result === "unavailable") {
          pushToast(AD_MISS_TOAST);
          policy.waive(g.progressStore.totalCompleted); // no interstitial on top of a failed door
        }
        else pushToast({ tone: "soft", text: "끝까지 보면 받을 수 있어" });
        setRewardReady(policy.ready("rewarded"));
        return;
      }
      offerStats.current?.note("earned", kind);
      track(`door_${kind}_earn`);
      if (o.kind === "rare") g.openPad(g.nextPad);
      else if (o.kind === "dig") g.openBonusPad();
      else if (o.kind === "seek" && o.seekId) {
        g.plantNext(o.seekId);
        planted.current = o.seekName ?? null;
        g.openPad(g.nextPad);
      } else if (pick) g.openPad(pick);
    } finally {
      sfx.unpause("ad");
      transitioning.current = false;
      if (gameRef.current === g) setWatching(false);
    }
  };

  /** the glitter cord's rewarded ad: the same pacing, sound pause and counting as the doors */
  const braceletAds: AdHook = {
    ready: () => ads.current?.ready("rewarded") ?? false,
    watch: async () => {
      const g = gameRef.current;
      const policy = ads.current;
      if (!g || !policy || transitioning.current) return false;
      transitioning.current = true;
      offerStats.current?.note("taken", "cord");
      track("door_cord_take");
      sfx.unlock();
      sfx.pause("ad");
      try {
        const result = await policy.next("rewarded", g.progressStore.totalCompleted, () => g.bracelets.earnGlitter());
        if (result === "rewarded") {
          g.bracelets.earnGlitter();
          offerStats.current?.note("earned", "cord");
          track("door_cord_earn");
          return true;
        }
        if (result) track(`door_cord_${result}`);
        return false;
      } finally {
        sfx.unpause("ad");
        transitioning.current = false;
      }
    },
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
                  {shareBusy ? "잠깐…" : gameRef.current?.daily.sharedOn(today()) ? "자랑하기 ↗" : "자랑하고 심기권 받기 ↗"}
                </button>
              )}
            </div>
          )}
          {phase === "free" && glimmer && !padEmpty && <div className="glimmer">안쪽에서 뭔가 반짝인다…</div>}
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
            <div className={"toasts" + (phase === "free" && padEmpty && flow !== "" ? " over-done" : "")}>
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
            {phase === "free" && padEmpty && flow === "ready" && next && (
              <div className="gate">
                {offer && doorShown && offer.kind === "choose" && (
                  <div className="door-choose" role="group" aria-label={offer.title}>
                    <span className="door-choose-label">{watching ? "잠깐…" : offer.title}</span>
                    <div className="door-chips">
                      {offer.alternatives!.map((p) => (
                        <button key={p.id} className="door-chip" onClick={() => void takeOffer(p)} disabled={watching}>
                          <PadSilhouette pad={p} size={22} mode="color" glint={false} />
                          <span>{p.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {offer && doorShown && offer.kind !== "choose" && (
                  <button className={"btn door" + (isFree(offer) ? " free" : "")} onClick={() => void takeOffer()} disabled={watching}>
                    <span className="door-icon" aria-hidden="true">
                      {offer.kind === "rare" ? (
                        <PadSilhouette pad={next.pad} size={22} mode="color" glint={false} />
                      ) : (offer.seekId ?? offer.digId) && TREASURE_TYPES.find((t) => t.id === (offer.seekId ?? offer.digId)) ? (
                        <BeadIcon
                          type={TREASURE_TYPES.find((t) => t.id === (offer.seekId ?? offer.digId))!}
                          size={24}
                          found={offer.kind === "dig" ? !offer.digNew : false}
                        />
                      ) : (
                        <span className="door-q">?</span>
                      )}
                    </span>
                    <span className="door-text">
                      <span>{watching ? "잠깐…" : offer.kind === "seek" && offer.seekName ? seekTitle(offer.seekName, !!offer.pinned, isFree(offer)) : offer.title}</span>
                      <small>{offer.sub}</small>
                    </span>
                  </button>
                )}
                <button className={doorShown ? "btn ghost" : "btn"} onClick={openNext} disabled={watching}>
                  {watching && !doorShown ? "잠깐…" : offer?.kind === "rare" && doorShown ? "그냥 다음" : "다음 패드 열기"}
                </button>
              </div>
            )}
          </div>
        </div>
        {sheet === "collection" && gameRef.current && <CollectionSheet game={gameRef.current} onClose={closeSheet} ads={braceletAds} />}
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
