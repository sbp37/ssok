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

/** Before the game reads its save. Never waits longer than `timeoutMs`; false when nothing was restored. */
export async function restoreBackup(timeoutMs = 600): Promise<boolean> {
  try {
    if (localStorage.getItem(MARKER) !== null) return false;
    // outside the Toss app this throws at once; inside it, a slow bridge must not hold the start
    const raw = await Promise.race([
      TossStorage.getItem(BACKUP_KEY),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    if (!raw || localStorage.getItem(MARKER) !== null) return false;
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object" || typeof (data as Record<string, unknown>)[MARKER] !== "string") return false;
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (key.startsWith(PREFIX) && key !== BACKUP_KEY && typeof value === "string") localStorage.setItem(key, value);
    }
    return true;
  } catch {
    return false;
  }
}

/** Copy the save now. Best effort: a missing host or a full disk only skips the copy. */
export async function backupNow(): Promise<void> {
  clearTimeout(pending);
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
