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
 */
export const CARD_SIZE = 7;
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
}

const count = (v: unknown, max = 9999) => (Number.isFinite(v) && (v as number) >= 0 ? Math.min(max, Math.floor(v as number)) : 0);
const text = (v: unknown) => (typeof v === "string" ? v : "");

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
        }
      : { stamps: 0, cards: 0, stampDay: "", tickets: 0, shareDay: "", dailyDay: "", firstDay: newPlayer ? day : "" };
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

/** today's gel: the same everyday pad and colour for everyone on that date */
export function dailyPad(day: string): PadType {
  const rng = new Rng(seedOf("ssok-daily-" + day));
  const pad = rng.pick(PADS);
  return { ...tinted(pad, [], () => rng.next()), daily: true };
}
