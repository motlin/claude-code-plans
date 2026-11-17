// @vitest-environment jsdom

import {act, cleanup, fireEvent, render} from "@testing-library/react";
import {useRef} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import
{
	armEnterGuard,
	ENTER_GUARD_MS,
	handoffTarget,
	pickUpHandoff,
	useFaceFocusHandoff,
} from "../src/lib/face-focus-handoff";

function Face({usable, pick}: {usable: boolean; pick: (face: HTMLElement) => HTMLElement | null})
{
	const ref = useRef<HTMLSpanElement>(null);
	useFaceFocusHandoff(ref, usable, pick);
	return (
		<span ref={ref} className="contents">
			<button type="button">Send</button>
		</span>
	);
}

function Host({
	usable = true,
	mounted = true,
	pick,
}: {
	usable?: boolean;
	mounted?: boolean;
	pick: (face: HTMLElement) => HTMLElement | null;
})
{
	return (
		<div>
			<textarea aria-label="Prompt" />
			{mounted && <Face usable={usable} pick={pick} />}
		</div>
	);
}

function setup(pick?: (face: HTMLElement) => HTMLElement | null)
{
	let textarea: HTMLTextAreaElement | null = null;
	const picker = pick ?? (() => textarea);
	const view = render(<Host pick={picker} />);
	textarea = view.container.querySelector("textarea");
	const button = view.container.querySelector("button");
	if (textarea === null || button === null) throw new Error("no fixture");
	return {
		...view,
		textarea,
		button,
		picker,
	};
}

afterEach(() =>
{
	cleanup();
	// A handoff arms the Enter guard on the document; any other key releases it.
	fireEvent.keyDown(
		document,
		{
			key: "Escape",
		},
	);
	vi.useRealTimers();
});

describe("useFaceFocusHandoff", () =>
{
	it("hands keyboard focus to the target when the face stops being usable", () =>
	{
		const {textarea, button, picker, rerender} = setup();
		button.focus();
		fireEvent.keyDown(
			button,
			{
				key: "Enter",
			},
		);
		rerender(<Host usable={false} pick={picker} />);
		expect(
			{
				focused: document.activeElement === textarea,
			},
		).toStrictEqual(
			{
				focused: true,
			},
		);
	});

	it("leaves pointer focus where it is", () =>
	{
		const {textarea, button, picker, rerender} = setup();
		fireEvent.pointerDown(button);
		button.focus();
		rerender(<Host usable={false} pick={picker} />);
		expect(
			{
				focused: document.activeElement === textarea,
			},
		).toStrictEqual(
			{
				focused: false,
			},
		);
	});

	it("does not count a modifier-only key as keyboard use", () =>
	{
		const {textarea, button, picker, rerender} = setup();
		button.focus();
		fireEvent.pointerDown(button);
		fireEvent.keyDown(
			button,
			{
				key: "Shift",
			},
		);
		rerender(<Host usable={false} pick={picker} />);
		expect(
			{
				focused: document.activeElement === textarea,
			},
		).toStrictEqual(
			{
				focused: false,
			},
		);
	});

	it("hands off when the face unmounts with keyboard focus inside", () =>
	{
		const {textarea, button, picker, rerender} = setup();
		button.focus();
		fireEvent.keyDown(
			button,
			{
				key: "Enter",
			},
		);
		rerender(<Host mounted={false} pick={picker} />);
		expect(
			{
				focused: document.activeElement === textarea,
			},
		).toStrictEqual(
			{
				focused: true,
			},
		);
	});

	it("moves nothing when the target is null", () =>
	{
		const {textarea, button, rerender} = setup(() => null);
		button.focus();
		fireEvent.keyDown(
			button,
			{
				key: "Enter",
			},
		);
		rerender(<Host usable={false} pick={() => null} />);
		expect(
			{
				focused: document.activeElement === textarea,
				onButton: document.activeElement === button,
			},
		).toStrictEqual(
			{
				focused: false,
				onButton: true,
			},
		);
	});
});

describe("armEnterGuard", () =>
{
	let textarea: HTMLTextAreaElement;
	let reached: string[];

	beforeEach(() =>
	{
		vi.useFakeTimers(
			{
				toFake: ["setTimeout", "clearTimeout", "Date", "performance"],
			},
		);
		document.body.innerHTML = "<textarea></textarea>";
		const found = document.querySelector("textarea");
		if (found === null) throw new Error("no textarea");
		textarea = found;
		reached = [];
		textarea.addEventListener("keydown", (event) =>
		{
			reached.push(event.repeat ? `${event.key}+repeat` : event.key);
		});
	});

	afterEach(() =>
	{
		document.body.innerHTML = "";
	});

	function press(key: string, repeat = false): void
	{
		fireEvent.keyDown(
			textarea,
			{
				key,
				repeat,
			},
		);
	}

	it("swallows an Enter right after arming and lets one through after the guard", () =>
	{
		const release = armEnterGuard(document);
		vi.advanceTimersByTime(10);
		press("Enter");
		vi.advanceTimersByTime(ENTER_GUARD_MS + 100);
		press("Enter");
		release();
		expect(reached).toStrictEqual(["Enter"]);
	});

	it("keeps swallowing a held Enter past the guard", () =>
	{
		const release = armEnterGuard(document);
		vi.advanceTimersByTime(400);
		press("Enter", true);
		vi.advanceTimersByTime(400);
		press("Enter", true);
		vi.advanceTimersByTime(400);
		press("Enter", true);
		release();
		expect(reached).toStrictEqual([]);
	});

	it("releases at once on another key", () =>
	{
		const release = armEnterGuard(document);
		press("Shift");
		press("a");
		press("Enter");
		release();
		expect(reached).toStrictEqual(["Shift", "a", "Enter"]);
	});
});

describe("handoffTarget", () =>
{
	let textarea: HTMLTextAreaElement;
	let face: HTMLElement;

	beforeEach(() =>
	{
		vi.useFakeTimers(
			{
				toFake: ["setTimeout", "clearTimeout", "Date", "performance"],
			},
		);
		document.body.innerHTML = '<textarea disabled></textarea><span class="contents"><button>Stop</button></span>';
		const foundTextarea = document.querySelector("textarea");
		const foundFace = document.querySelector("span");
		if (foundTextarea === null || foundFace === null) throw new Error("no fixture");
		textarea = foundTextarea;
		face = foundFace;
	});

	afterEach(() =>
	{
		document.body.innerHTML = "";
	});

	function reEnable(): boolean
	{
		textarea.disabled = false;
		pickUpHandoff(textarea);
		return document.activeElement === textarea;
	}

	it("waits for a disabled editor and lands when it re-enables within a second", () =>
	{
		const target = handoffTarget(textarea, face, true);
		vi.advanceTimersByTime(500);
		expect(
			{
				target,
				focused: reEnable(),
			},
		).toStrictEqual(
			{
				target: null,
				focused: true,
			},
		);
	});

	it("forgets the handoff after a second", () =>
	{
		handoffTarget(textarea, face, true);
		vi.advanceTimersByTime(1200);
		expect(
			{
				focused: reEnable(),
			},
		).toStrictEqual(
			{
				focused: false,
			},
		);
	});

	it("forgets the handoff on a pointerdown", () =>
	{
		handoffTarget(textarea, face, true);
		act(() =>
		{
			fireEvent.pointerDown(document.body);
		});
		expect(
			{
				focused: reEnable(),
			},
		).toStrictEqual(
			{
				focused: false,
			},
		);
	});

	it("returns an enabled editor at once", () =>
	{
		textarea.disabled = false;
		expect(
			{
				same: handoffTarget(textarea, face, false) === textarea,
			},
		).toStrictEqual(
			{
				same: true,
			},
		);
	});
});
