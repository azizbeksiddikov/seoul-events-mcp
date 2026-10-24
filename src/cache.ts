/** Tiny in-memory TTL cache with in-flight request de-duplication. Errors are never cached. */
export class TtlCache {
	private store = new Map<string, { value: unknown; expires: number }>();
	private inflight = new Map<string, Promise<unknown>>();

	constructor(
		private readonly ttlMs: number,
		private readonly now: () => number = Date.now,
	) {}

	get<T>(key: string): T | undefined {
		const hit = this.store.get(key);
		if (!hit) return undefined;
		if (hit.expires <= this.now()) {
			this.store.delete(key);
			return undefined;
		}
		return hit.value as T;
	}

	set(key: string, value: unknown): void {
		this.store.set(key, { value, expires: this.now() + this.ttlMs });
	}

	async wrap<T>(key: string, fn: () => Promise<T>): Promise<T> {
		const cached = this.get<T>(key);
		if (cached !== undefined) return cached;
		const pending = this.inflight.get(key);
		if (pending) return pending as Promise<T>;
		const p = fn()
			.then((v) => {
				this.set(key, v);
				return v;
			})
			.finally(() => this.inflight.delete(key));
		this.inflight.set(key, p);
		return p;
	}

	get size(): number {
		return this.store.size;
	}
}
