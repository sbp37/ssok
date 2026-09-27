type Listener<T> = (payload: T) => void;

/** Tiny typed event emitter. `on` returns the unsubscribe function. */
export class Emitter<E extends object> {
  private map = new Map<keyof E, Set<Listener<never>>>();
  on<K extends keyof E>(k: K, fn: Listener<E[K]>) {
    let s = this.map.get(k);
    if (!s) this.map.set(k, (s = new Set()));
    s.add(fn as Listener<never>);
    return () => {
      s!.delete(fn as Listener<never>);
    };
  }
  emit<K extends keyof E>(k: K, payload: E[K]) {
    this.map.get(k)?.forEach((fn) => (fn as Listener<E[K]>)(payload));
  }
}
