import { PADS, type PadType } from "../pads/PadTypes";
import { tinted } from "../pads/colors";
import { Rng } from "../util/math";

/**
 * The day-to-day, all in-game – no points, no cash:
 *
 *  오늘의 젤  from a player's second day on, the first pad opened each day is the
 *             day's own pad – the same shape and colour for everyone that day –
 *             and it always buries a treasure.
 *  도장판     one stamp a day for emptying a pad; a missed day costs nothing.
 *             Seven stamps → one plant ticket, and a fresh card.
 *  심기권     makes the "심기" door free (no ad). One more for a share, once a day.
 *  연속 출석  days in a row with a visit. Every third day in a row, that day's gel is a
 *             무지개 젤: the same pad in rainbow silicone, burying a treasure never found
 *             before while its pad still hides one. A missed day starts the count again.
 */
export const CARD_SIZE = 7;
/** every this many days in a row, the gel of the day is a rainbow gel */
export const STREAK_GOAL = 3;
/** the rainbow gel's own silicone: a pale base the rainbow is painted over (gel/Gel.ts) */
export const RAINBOW_BASE = { r: 244, g: 232, b: 250 };
const KEY = "ssok.daily.v1";

interface Save {
  /** stamps on the current card (0…CARD_SIZE-1) */
  stamps: number;
  /** cards filled so far */
  cards: number;
  /** the day of the last stamp */
  stampDay: string;
  tickets: number;
  /** the day of the last share that paid a ticket */
  shareDay: string;
  /** the day today's gel was last opened */
  dailyDay: string;
  /** a new player's first day – no gel of the day until the next one ("" = any day) */
  firstDay: string;
  /** days in a row with a visit, up to `visitDay` */
  streak: number;
  visitDay: string;
  /** the day whose gel of the day is a rainbow gel */
  rainbowDay: string;
}

const count = (v: unknown, max = 9999) => (Number.isFinite(v) && (v as number) >= 0 ? Math.min(max, Math.floor(v as number)) : 0);
const text = (v: unknown) => (typeof v === "string" ? v : "");
/** a well-formed day ("2026-10-25" – compares as text in calendar order), else "" */
const dayText = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");

export class DailyStore {
  private s: Save;

  /** `newPlayer`: nothing played yet – today's gel starts tomorrow */
  constructor(day: string, newPlayer: boolean, private storage: Pick<Storage, "getItem" | "setItem"> | undefined = undefined) {
    let saved: Partial<Save> | null = null;
    try {
      this.storage ??= localStorage;
      saved = JSON.parse(this.storage.getItem(KEY) || "null");
    } catch {
      saved = null;
    }
    this.s = saved && typeof saved === "object"
      ? {
          stamps: count(saved.stamps, CARD_SIZE - 1),
          cards: count(saved.cards),
          stampDay: text(saved.stampDay),
          tickets: count(saved.tickets, 99),
          shareDay: text(saved.shareDay),
          dailyDay: text(saved.dailyDay),
          firstDay: text(saved.firstDay),
          streak: count(saved.streak),
          visitDay: dayText(saved.visitDay),
          rainbowDay: dayText(saved.rainbowDay),
        }
      : {
          stamps: 0, cards: 0, stampDay: "", tickets: 0, shareDay: "", dailyDay: "", firstDay: newPlayer ? day : "",
          streak: 0, visitDay: "", rainbowDay: "",
        };
    this.save();
  }

  private save() {
    try {
      this.storage?.setItem(KEY, JSON.stringify(this.s));
    } catch {
      /* private mode: kept for this session */
    }
  }

  get stamps() {
    return this.s.stamps;
  }
  get cards() {
    return this.s.cards;
  }
  get tickets() {
    return this.s.tickets;
  }
  /** was today's stamp given already */
  stampedOn(day: string) {
    return this.s.stampDay === day;
  }

  /** a pad emptied on `day`: the day's stamp, once. `full`: that stamp finished a card (+1 ticket). */
  stamp(day: string): { stamped: boolean; n: number; full: boolean } {
    if (this.s.stampDay === day) return { stamped: false, n: this.s.stamps, full: false };
    this.s.stampDay = day;
    const n = this.s.stamps + 1;
    const full = n >= CARD_SIZE;
    if (full) {
      this.s.stamps = 0;
      this.s.cards++;
      this.s.tickets++;
    } else this.s.stamps = n;
    this.save();
    return { stamped: true, n, full };
  }

  /** spend a plant ticket; false when there is none */
  useTicket() {
    if (this.s.tickets <= 0) return false;
    this.s.tickets--;
    this.save();
    return true;
  }

  /** did a share already pay its ticket on `day` */
  sharedOn(day: string) {
    return this.s.shareDay === day;
  }
  /** a share on `day`: a ticket for the first one that day */
  shared(day: string) {
    if (this.s.shareDay === day) return false;
    this.s.shareDay = day;
    this.s.tickets++;
    this.save();
    return true;
  }

  /** days in a row with a visit (0 before the first) */
  get streak() {
    return this.s.streak;
  }
  /**
   * The player is here on `day`: the streak goes on from yesterday or starts again, and every
   * STREAK_GOAL-th day in a row makes that day's gel a rainbow gel. `first`: the day's first visit.
   */
  visit(day: string): { streak: number; first: boolean } {
    if (this.s.visitDay === day) return { streak: this.s.streak, first: false };
    // the clock went back a day (a time zone, an auto-corrected clock around midnight): nothing changes.
    // Further back, the saved day was wrong – the count starts again, and a rainbow day ahead is gone.
    if (this.s.visitDay > day && dayBefore(this.s.visitDay) === day) return { streak: this.s.streak, first: false };
    this.s.streak = this.s.visitDay === dayBefore(day) ? this.s.streak + 1 : 1;
    this.s.visitDay = day;
    if (this.s.rainbowDay > day) this.s.rainbowDay = "";
    if (this.s.streak % STREAK_GOAL === 0) this.s.rainbowDay = day;
    this.save();
    return { streak: this.s.streak, first: true };
  }
  /** is `day`'s gel a rainbow gel */
  rainbowOn(day: string) {
    return this.s.rainbowDay === day;
  }

  /** today's gel has not been opened today (and today is not a new player's first day) */
  dailyDue(day: string) {
    return this.s.dailyDay !== day && this.s.firstDay !== day;
  }
  openedDaily(day: string) {
    this.s.dailyDay = day;
    this.save();
  }
}

/** a stable 32-bit seed from a day string (FNV-1a) */
function seedOf(day: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < day.length; i++) {
    h ^= day.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** the calendar day before `day` ("2026-11-01" → "2026-10-31"), in the format of `today()` */
export function dayBefore(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(y, m - 1, d - 1);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

/** today's gel: the same everyday pad and colour for everyone on that date – on a rainbow day,
 * the same pad in rainbow silicone */
export function dailyPad(day: string, rainbow = false): PadType {
  const rng = new Rng(seedOf("ssok-daily-" + day));
  const pad = rng.pick(PADS);
  const gel = { ...tinted(pad, [], () => rng.next()), daily: day };
  return rainbow ? { ...gel, gelColor: { ...RAINBOW_BASE }, rainbow: true } : gel;
}
