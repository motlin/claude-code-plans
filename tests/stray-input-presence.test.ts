// @vitest-environment jsdom

import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {presenceTrust, watchPresence} from "../src/lib/stray-input-presence";

const watched: Array<
{
	dispose(): void;
}> = [];

function watch()
{
	const presence = watchPresence(window);
	watched.push(presence);
	return presence;
}

/** jsdom can't make trusted events, so the trust check is swapped for one that trusts everything. */
function trustEverything(): void
{
	vi.spyOn(presenceTrust, "isTrusted").mockReturnValue(true);
}

function frame(): HTMLIFrameElement
{
	const iframe = document.createElement("iframe");
	document.body.append(iframe);
	return iframe;
}

/** jsdom moves focus into an iframe without the focusin a browser fires on it, so fire it here. */
function focusFrame(iframe: HTMLIFrameElement): void
{
	iframe.focus();
	iframe.dispatchEvent(
		new FocusEvent(
			"focusin",
			{
				bubbles: true,
			},
		),
	);
}

/** jsdom can't blur a focused iframe either, so move focus out through a throwaway button, with the focusout a browser fires. */
function leaveFrame(): void
{
	const iframe = document.activeElement;
	const button = document.createElement("button");
	document.body.append(button);
	button.focus();
	iframe?.dispatchEvent(
		new FocusEvent(
			"focusout",
			{
				bubbles: true,
			},
		),
	);
	button.blur();
	button.remove();
}

function pressAndClick(target: Element): void
{
	target.dispatchEvent(
		new MouseEvent(
			"pointerdown",
			{
				bubbles: true,
			},
		),
	);
	target.dispatchEvent(
		new MouseEvent(
			"click",
			{
				bubbles: true,
				detail: 1,
			},
		),
	);
}

afterEach(() =>
{
	// The type-to-focus hook's own per-window presence also hears these events, so leave the window present.
	leaveFrame();
	trustEverything();
	pressAndClick(document.body);
	vi.restoreAllMocks();
	for (const presence of watched.splice(0)) presence.dispose();
	document.body.replaceChildren();
});

describe("stray input presence", () =>
{
	it("starts present, goes away when focus moves into an iframe, and stays away after focus comes back", () =>
	{
		const presence = watch();
		const before = presence.isPresent();
		const iframe = frame();

		focusFrame(iframe);
		const inFrame = presence.isPresent();
		leaveFrame();

		expect(
			{
				before,
				inFrame,
				after: presence.isPresent(),
			},
		).toStrictEqual(
			{
				before: true,
				inFrame: false,
				after: false,
			},
		);
	});

	it("is present again after a trusted press and click in the page, but not after an untrusted one", () =>
	{
		const presence = watch();
		const iframe = frame();
		focusFrame(iframe);
		leaveFrame();

		pressAndClick(document.body);
		const untrusted = presence.isPresent();
		trustEverything();
		pressAndClick(document.body);

		expect(
			{
				untrusted,
				trusted: presence.isPresent(),
			},
		).toStrictEqual(
			{
				untrusted: false,
				trusted: true,
			},
		);
	});

	it("does not count a click while an iframe holds focus, a click with no press, or a click on a toast", () =>
	{
		const presence = watch();
		const iframe = frame();
		const toast = document.createElement("div");
		toast.dataset["cds"] = "Toast";
		document.body.append(toast);
		trustEverything();

		focusFrame(iframe);
		pressAndClick(document.body);
		const whileInFrame = presence.isPresent();
		leaveFrame();
		document.body.dispatchEvent(
			new MouseEvent(
				"click",
				{
					bubbles: true,
					detail: 1,
				},
			),
		);
		const clickOnly = presence.isPresent();
		pressAndClick(toast);

		expect(
			{
				whileInFrame,
				clickOnly,
				onToast: presence.isPresent(),
			},
		).toStrictEqual(
			{
				whileInFrame: false,
				clickOnly: false,
				onToast: false,
			},
		);
	});

	it("starts away when an iframe already holds focus as watching begins", () =>
	{
		const iframe = frame();
		iframe.focus();
		const presence = watch();

		expect(presence.isPresent()).toBe(false);
	});

	it("stops listening once disposed", () =>
	{
		const presence = watch();
		presence.dispose();
		const iframe = frame();

		focusFrame(iframe);

		expect(presence.isPresent()).toBe(true);
	});
});
