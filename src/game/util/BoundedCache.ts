/** Small LRU for raster sprites: endless play must not retain every old pad,
 * rotation and socket-healing frame. Current drawings keep their own canvas. */
export class BoundedCache<K, V> extends Map<K, V> {
  constructor(private readonly capacity: number) {
    super();
  }
  override get(key: K): V | undefined {
    const value = super.get(key);
    if (value !== undefined) {
      super.delete(key);
      super.set(key, value);
    }
    return value;
  }
  override set(key: K, value: V): this {
    super.delete(key);
    super.set(key, value);
    if (this.size > this.capacity) super.delete(this.keys().next().value!);
    return this;
  }
}
