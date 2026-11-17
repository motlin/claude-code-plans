// @vitest-environment jsdom

import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";

import
{
	AUTO_RESUME_OPT_IN_KEY,
	type AutoResumeEntry,
	afterFire,
	fireAtSeconds,
	getAutoResumeEntry,
	liveEntry,
	offerEntry,
	readOptInPref,
	resetAutoResumeStore,
	setAutoResumeEntry,
	supersede,
	toggle,
	toggleAutoResume,
} from "../src/lib/limit-auto-resume";

const NOW_MS = 1_800_000_000_000;
const RESETS_AT = NOW_MS / 1000 + 600;

const FIVE_HOUR =
{
	resetsAt: RESETS_AT,
	rateLimitType: "five_hour",
};

const ARMED: AutoResumeEntry =
{
	resetsAt: RESETS_AT,
	attempt: 0,
	optedIn: true,
	armed: true,
};

describe("offerEntry", () =>
{
	it("offers nothing for a weekly limit", () =>
	{
		expect(
			offerEntry(
				undefined,
				{
					resetsAt: RESETS_AT,
					rateLimitType: "seven_day",
				},
				null,
			),
		).toBeUndefined();
	});

	it("arms a first five-hour limit with no pref (local default-on)", () =>
	{
		expect(offerEntry(undefined, FIVE_HOUR, null)).toStrictEqual(ARMED);
	});

	it("leaves the entry unchecked when the pref is false", () =>
	{
		expect(offerEntry(undefined, FIVE_HOUR, false)).toStrictEqual(
			{
				...ARMED,
				optedIn: false,
				armed: false,
			},
		);
	});

	it("keeps the attempt for a window within an hour of the previous one", () =>
	{
		const prev = afterFire(ARMED);
		expect(
			offerEntry(
				prev,
				{
					...FIVE_HOUR,
					resetsAt: RESETS_AT + 1800,
				},
				null,
			),
		).toStrictEqual(
			{
				resetsAt: RESETS_AT + 1800,
				attempt: 1,
				optedIn: true,
				armed: true,
			},
		);
	});

	it("starts a later window over at attempt 0", () =>
	{
		const prev = supersede(afterFire(ARMED));
		expect(
			offerEntry(
				prev,
				{
					...FIVE_HOUR,
					resetsAt: RESETS_AT + 7200,
				},
				null,
			),
		).toStrictEqual(
			{
				...ARMED,
				resetsAt: RESETS_AT + 7200,
			},
		);
	});

	it("keeps a superseded entry in the same window disarmed", () =>
	{
		expect(offerEntry(supersede(ARMED), FIVE_HOUR, null)).toStrictEqual(
			{
				...ARMED,
				armed: false,
				superseded: true,
			},
		);
	});
});

describe("liveEntry", () =>
{
	it("drops an entry after three attempts", () =>
	{
		expect(
			liveEntry(
				{
					...ARMED,
					attempt: 3,
				},
				NOW_MS,
			),
		).toBeUndefined();
	});

	it("drops an entry whose reset is more than 6h ago", () =>
	{
		const resetsAt = NOW_MS / 1000 - 21_600;
		expect(
			liveEntry(
				{
					...ARMED,
					resetsAt,
				},
				NOW_MS,
			),
		).toBeUndefined();
		expect(
			liveEntry(
				{
					...ARMED,
					resetsAt: resetsAt + 1,
				},
				NOW_MS,
			),
		).toStrictEqual(
			{
				...ARMED,
				resetsAt: resetsAt + 1,
			},
		);
	});
});

describe("fireAtSeconds", () =>
{
	it("is the reset plus 90 s on the first attempt, else the reset", () =>
	{
		const entry =
		{
			resetsAt: 1000,
			attempt: 0,
			optedIn: true,
			armed: true,
		};
		expect(fireAtSeconds(entry)).toBe(1090);
		expect(
			fireAtSeconds(
				{
					...entry,
					attempt: 1,
				},
			),
		).toBe(1000);
	});
});

describe("toggle", () =>
{
	it("re-arms and clears superseded, like upstream's checkbox", () =>
	{
		expect(toggle(supersede(ARMED), true, NOW_MS)).toStrictEqual(ARMED);
	});

	it("disarms when unchecked", () =>
	{
		expect(toggle(ARMED, false, NOW_MS)).toStrictEqual(
			{
				...ARMED,
				optedIn: false,
				armed: false,
			},
		);
	});

	it("does not arm a stale entry", () =>
	{
		const stale =
		{
			...ARMED,
			optedIn: false,
			armed: false,
			resetsAt: NOW_MS / 1000 - 21_600,
		};
		expect(toggle(stale, true, NOW_MS)).toStrictEqual(
			{
				...stale,
				optedIn: true,
			},
		);
	});
});

describe("toggleAutoResume", () =>
{
	beforeEach(() =>
	{
		localStorage.clear();
		resetAutoResumeStore();
	});
	afterEach(() =>
	{
		localStorage.clear();
		resetAutoResumeStore();
	});

	it("writes the global pref and mirrors the choice to the other sessions", () =>
	{
		setAutoResumeEntry("a", ARMED);
		setAutoResumeEntry("b", ARMED);
		setAutoResumeEntry("c", supersede(ARMED));

		toggleAutoResume("a", false, NOW_MS);
		expect(localStorage.getItem(AUTO_RESUME_OPT_IN_KEY)).toBe("false");
		expect(readOptInPref()).toBe(false);
		expect([getAutoResumeEntry("a"), getAutoResumeEntry("b"), getAutoResumeEntry("c")]).toStrictEqual([
			{
				...ARMED,
				optedIn: false,
				armed: false,
			},
			{
				...ARMED,
				armed: false,
			},
			{
				...ARMED,
				armed: false,
				superseded: true,
			},
		]);

		toggleAutoResume("a", true, NOW_MS);
		expect(readOptInPref()).toBe(true);
		expect([getAutoResumeEntry("a"), getAutoResumeEntry("b"), getAutoResumeEntry("c")]).toStrictEqual([
			ARMED,
			ARMED,
			{
				...ARMED,
				armed: false,
				superseded: true,
			},
		]);
	});

	it("reads no pref as null", () =>
	{
		expect(readOptInPref()).toBeNull();
	});
});
