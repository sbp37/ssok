import { Storage as TossStorage } from "@apps-in-toss/web-framework";

/**
 * A copy of the whole save – every "ssok." key – in Toss's native storage.
 * The web view's own storage can be wiped (storage pressure, cleared data);
 * when a start finds it empty but a copy exists, the collection, the album
 * and the record of promotions already paid come back before the game reads
 * them. A save that exists is never overwritten by the copy.
 */
const BACKUP_KEY = "ssok.backup.v1";
const PREFIX = "ssok.";
/** present once a player has opened a pad: its absence means "nothing saved here" */
const MARKER = "ssok.progress.v2";

function snapshot(): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    const value = key && key.startsWith(PREFIX) && key !== BACKUP_KEY ? localStorage.getItem(key) : null;
    if (key && value !== null) out[key] = value;
  }
  return out;
}

/** "unknown" while a slow native read is still out: nothing may overwrite the copy before it is known */
let copyState: "known" | "unknown" = "known";

const completed = (save: string | null | undefined) => {
  try {
    const n = save ? (JSON.parse(save) as { totalCompleted?: unknown }).totalCompleted : 0;
    return typeof n === "number" && Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
};

/** Write a copy into the web view. `late`: a game already started meanwhile – only a copy
 * with more play than that wins. */
function apply(raw: string, late: boolean): boolean {
  const data: unknown = JSON.parse(raw);
  if (!data || typeof data !== "object") return false;
  const copy = data as Record<string, unknown>;
  if (typeof copy[MARKER] !== "string") return false;
  const local = localStorage.getItem(MARKER);
  if (late ? completed(copy[MARKER] as string) <= completed(local) : local !== null) return false;
  for (const [key, value] of Object.entries(copy)) {
    if (key.startsWith(PREFIX) && key !== BACKUP_KEY && typeof value === "string") localStorage.setItem(key, value);
  }
  return true;
}

/**
 * Before the game reads its save. Never holds the start longer than `timeoutMs`;
 * true when a copy was restored. A read slower than that is not given up: until it
 * answers no copy is written over the old one, and if it brings a save with more
 * play than the game started meanwhile, it is restored and `onLate` reloads.
 */
export async function restoreBackup(timeoutMs = 1500, onLate?: () => void): Promise<boolean> {
  try {
    if (localStorage.getItem(MARKER) !== null) return false;
    // outside the Toss app this throws at once
    const read = TossStorage.getItem(BACKUP_KEY);
    let timedOut = false;
    const raw = await Promise.race([
      read,
      new Promise<null>((resolve) => setTimeout(() => ((timedOut = true), resolve(null)), timeoutMs)),
    ]);
    if (!timedOut) return !!raw && apply(raw, false);
    copyState = "unknown";
    read.then(
      (late) => {
        try {
          if (late && apply(late, true)) return onLate?.();
          // no copy, or one with less play than now: nothing left to protect
          copyState = "known";
        } catch {
          copyState = "known"; // an unreadable copy is not worth keeping either
        }
      },
      () => {
        /* the bridge failed: keep the old copy untouched for this session */
      },
    );
    return false;
  } catch {
    return false;
  }
}

/** Copy the save now. Best effort: a missing host or a full disk only skips the copy. */
export async function backupNow(): Promise<void> {
  clearTimeout(pending);
  if (copyState === "unknown") return;
  try {
    const data = snapshot();
    if (!(MARKER in data)) return;
    await TossStorage.setItem(BACKUP_KEY, JSON.stringify(data));
  } catch {
    /* no Toss host, or the bridge refused: the web view's save still stands */
  }
}

let pending: ReturnType<typeof setTimeout> | undefined;
/** Copy the save shortly – several changes in a row make one copy. */
export function backupSoon(delayMs = 1500) {
  clearTimeout(pending);
  pending = setTimeout(() => void backupNow(), delayMs);
}
