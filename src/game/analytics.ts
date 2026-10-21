import { Analytics } from "@apps-in-toss/web-framework";

/**
 * Funnel events for the console (분석 › 이벤트 – live builds only, a day late).
 * The console counts event names and shows parameters only as values, so what a
 * question needs counted goes into the name: `door_seek_offer`, `pad_done_3`.
 * Never throws: a browser without the Toss host simply logs nothing.
 */
export function track(name: string, params: Record<string, string | number | boolean> = {}) {
  try {
    void Analytics.log({ log_name: name, log_type: "event", params })?.catch(() => {});
  } catch {
    /* no Toss host */
  }
}
