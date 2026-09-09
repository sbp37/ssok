/**
 * Optional recorded samples. `public/sfx/manifest.json` maps names to files;
 * anything missing falls back to the procedural synth in Sfx.ts. Loaded lazily
 * after the first user gesture so it never delays first paint.
 */
export type SampleName =
  | "press"
  | "stretch"
  | "tick"
  | "pop_small"
  | "pop_big"
  | "release"
  | "creak"
  | "give"
  | "land_glass"
  | "land_plastic"
  | "land_metal"
  | "land_shell"
  | "rare";

interface Manifest {
  samples?: Partial<Record<SampleName, string>>;
}

export class SampleBank {
  private buffers = new Map<SampleName, AudioBuffer>();
  private started = false;

  has(name: SampleName) {
    return this.buffers.has(name);
  }
  get(name: SampleName) {
    return this.buffers.get(name);
  }

  load(ctx: AudioContext) {
    if (this.started) return;
    this.started = true;
    const base = `${import.meta.env.BASE_URL}sfx/`;
    void (async () => {
      try {
        const res = await fetch(`${base}manifest.json`, { cache: "force-cache" });
        if (!res.ok) return;
        const m = (await res.json()) as Manifest;
        const entries = Object.entries(m.samples ?? {}) as [SampleName, string][];
        await Promise.all(
          entries.map(async ([name, file]) => {
            try {
              const r = await fetch(base + file);
              if (!r.ok) return;
              const buf = await ctx.decodeAudioData(await r.arrayBuffer());
              this.buffers.set(name, buf);
            } catch {
              /* keep procedural fallback for this one */
            }
          }),
        );
      } catch {
        /* no manifest → all procedural */
      }
    })();
  }
}
