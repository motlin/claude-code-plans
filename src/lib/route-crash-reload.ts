// Upstream's crash-screen Reload (`CC`/`hQ`/`vK`): a warm `location.reload()` at most once per 10 minutes per tab,
// otherwise a cold boot that navigates to the same URL with `?cold=` so a reload loop can't keep a broken page warm.

export const CRASH_WARM_RELOAD_KEY = "spa_crash_warm_reload_at";
const CRASH_WARM_RELOAD_MS = 600_000;

export interface CrashReloadDeps
{
	storage: () => Storage;
	now: () => number;
	href: () => string;
	reload: () => void;
	navigate: (href: string) => void;
}

const browserCrashReloadDeps: CrashReloadDeps =
{
	storage: () => window.sessionStorage,
	now: () => Date.now(),
	href: () => window.location.href,
	reload: () =>
	{
		window.location.reload();
	},
	navigate: (href) =>
	{
		window.location.href = href;
	},
};

/** Claims this tab's warm reload unless one ran within the window; false when storage can't record the claim. */
function claimWarmReload(deps: CrashReloadDeps): boolean
{
	try
	{
		const storage = deps.storage();
		const last = Number(storage.getItem(CRASH_WARM_RELOAD_KEY));
		const now = deps.now();
		if (last > 0 && now - last >= 0 && now - last < CRASH_WARM_RELOAD_MS) return false;
		storage.setItem(CRASH_WARM_RELOAD_KEY, String(now));
		return storage.getItem(CRASH_WARM_RELOAD_KEY) === String(now);
	}
	catch
	{
		return false;
	}
}

export function reloadAfterCrash(deps: CrashReloadDeps = browserCrashReloadDeps): void
{
	if (claimWarmReload(deps))
	{
		deps.reload();
		return;
	}
	const url = new URL(deps.href());
	url.searchParams.set("cold", "");
	deps.navigate(url.toString());
}

/** Upstream's Home is a hard navigation; locally `/` is the New session home. */
export function navigateHomeAfterCrash(): void
{
	window.location.assign("/");
}
