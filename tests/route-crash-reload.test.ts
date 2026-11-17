import {describe, expect, it} from "vite-plus/test";
import {CRASH_WARM_RELOAD_KEY, reloadAfterCrash, type CrashReloadDeps} from "../src/lib/route-crash-reload";
import {createFakeStorage} from "./fake-storage";

function harness()
{
	const storage = createFakeStorage();
	const calls: string[] = [];
	let now = 1_000_000;
	const deps: CrashReloadDeps =
	{
		storage: () => storage,
		now: () => now,
		href: () => "http://localhost:7526/session/abc?pane=files",
		reload: () =>
		{
			calls.push("reload");
		},
		navigate: (href) =>
		{
			calls.push(`navigate ${href}`);
		},
	};
	return {
		storage,
		calls,
		deps,
		advance: (ms: number) =>
		{
			now += ms;
		},
	};
}

describe("reloadAfterCrash", () =>
{
	it("warm-reloads at most once per 10 minutes and cold-boots in between, like upstream's CC", () =>
	{
		const {storage, calls, deps, advance} = harness();

		reloadAfterCrash(deps);
		advance(599_999);
		reloadAfterCrash(deps);
		advance(1);
		reloadAfterCrash(deps);

		expect(
			{
				calls,
				stored: storage.getItem(CRASH_WARM_RELOAD_KEY),
			},
		).toStrictEqual(
			{
				calls: ["reload", "navigate http://localhost:7526/session/abc?pane=files&cold=", "reload"],
				stored: "1600000",
			},
		);
	});

	it("cold-boots when sessionStorage throws", () =>
	{
		const {calls, deps} = harness();

		reloadAfterCrash(
			{
				...deps,
				storage: () =>
				{
					throw new Error("denied");
				},
			},
		);

		expect(calls).toStrictEqual(["navigate http://localhost:7526/session/abc?pane=files&cold="]);
	});
});
