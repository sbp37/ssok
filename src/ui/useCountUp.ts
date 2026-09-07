import { useEffect, useState } from "react";

/** eases a number up from 0 to target over `ms` */
export function useCountUp(target: number, ms = 900, delay = 200) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    let start = 0;
    const tick = (t: number) => {
      if (!start) start = t;
      const k = Math.min(1, (t - start - delay) / ms);
      if (k < 0) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const e = 1 - Math.pow(1 - k, 3);
      setV(Math.round(target * e));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms, delay]);
  return v;
}
