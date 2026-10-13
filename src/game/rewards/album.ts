/**
 * The jar album: every emptied pad leaves its jar behind – which beads, in
 * which colours, in the order they landed – so a play session becomes a row of
 * little jars to look back on. Kept small (the last JAR_LIMIT jars).
 */
export interface JarEntry {
  /** when the pad was emptied (ms) */
  at: number;
  /** pad name and id at the time */
  pad: string;
  padId: string;
  /** [bead type id, colour], landing order */
  beads: [string, string][];
}

const KEY = "ssok.jars.v1";
export const JAR_LIMIT = 24;
/** a jar holds this many for the album – enough to read as "full" */
export const JAR_BEADS = 40;

export class JarAlbum {
  private jars: JarEntry[] = [];
  private listeners = new Set<() => void>();
  constructor(private storage: Pick<Storage, "getItem" | "setItem"> | undefined = undefined) {
    try {
      this.storage ??= localStorage;
      const raw = JSON.parse(this.storage.getItem(KEY) || "null");
      if (Array.isArray(raw)) {
        this.jars = raw
          .filter((j): j is JarEntry =>
            !!j && Number.isFinite(j.at) && typeof j.pad === "string" && typeof j.padId === "string" && Array.isArray(j.beads))
          .map((j) => ({
            ...j,
            beads: j.beads.filter((b): b is [string, string] => Array.isArray(b) && typeof b[0] === "string" && typeof b[1] === "string").slice(0, JAR_BEADS),
          }))
          .slice(-JAR_LIMIT);
      }
    } catch {
      /* private mode / bad data: start an empty album */
    }
  }
  private save() {
    try {
      this.storage?.setItem(KEY, JSON.stringify(this.jars));
    } catch {
      /* optional */
    }
    this.listeners.forEach((l) => l());
  }
  subscribe(l: () => void) {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }
  add(entry: JarEntry) {
    if (!entry.beads.length) return;
    this.jars.push({ ...entry, beads: entry.beads.slice(0, JAR_BEADS) });
    if (this.jars.length > JAR_LIMIT) this.jars.splice(0, this.jars.length - JAR_LIMIT);
    this.save();
  }
  /** newest first */
  get latest(): readonly JarEntry[] {
    return [...this.jars].reverse();
  }
  get size() {
    return this.jars.length;
  }
}
