/**
 * Upstream's capped localStorage record map (`c4ea84cb3` `X`, which backs
 * `epitaxy.railNoConnectors.v1` and `epitaxy.sessionPaneScroll.v1`): one JSON
 * object of `{[id]: {...value, at}}` under `key`. Every read re-parses storage;
 * a write stamps `at: Date.now()` and evicts the oldest `at` above `cap`. A
 * corrupt or missing map reads as empty and every storage error is swallowed.
 */
export interface CappedStorageMap<
	T extends
	{
		at: number;
	},
>
{
	read(id: string): T | undefined;
	/** Stores `value` stamped with `at`; `null` deletes the id. */
	write(id: string, value: Omit<T, "at"> | null): void;
}

export function createCappedStorageMap<
	T extends
	{
		at: number;
	},
>({key, cap, valid}: {key: string; cap: number; valid: (value: unknown) => value is T}): CappedStorageMap<T>
{
	const load = (): Map<string, unknown> =>
	{
		try
		{
			const raw = window.localStorage.getItem(key);
			if (!raw) return new Map();
			const parsed: unknown = JSON.parse(raw);
			return new Map(typeof parsed === "object" && parsed !== null ? Object.entries(parsed) : []);
		}
		catch
		{
			return new Map();
		}
	};
	return {
		read(id)
		{
			const entry = load().get(id);
			return valid(entry) ? entry : undefined;
		},
		write(id, value)
		{
			try
			{
				const map = load();
				if (value === null) map.delete(id);
				else
					map.set(
						id,
						{
							...value,
							at: Date.now(),
						},
					);
				if (map.size > cap)
				{
					const at = (entry: unknown): number =>
						typeof entry === "object" && entry !== null && "at" in entry && typeof entry.at === "number"
							? entry.at
							: 0;
					const oldest = [...map].toSorted(([, a], [, b]) => at(a) - at(b)).slice(0, map.size - cap);
					for (const [each] of oldest) map.delete(each);
				}
				window.localStorage.setItem(key, JSON.stringify(Object.fromEntries(map)));
			}
			catch
			{
				// Storage unavailable: upstream drops the write.
			}
		},
	};
}
