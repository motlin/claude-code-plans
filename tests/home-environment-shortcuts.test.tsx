// @vitest-environment jsdom

import {act, cleanup, render, screen, within} from "@testing-library/react";
import {useState} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {StartCard} from "../src/components/home/start-card";
import type {StartProject} from "../src/lib/palette-start-session";

const PROJECTS: StartProject[] = [1, 2, 3].map((n) => ({
	id: `-users-dev-p${n}`,
	name: `p${n}`,
	projectPath: `/Users/dev/projects/p${n}`,
}));

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const WINDOWS_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const LINUX_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36";

function Harness() {
	const [selectedId, setSelectedId] = useState(PROJECTS[0]?.id);
	return (
		<StartCard projects={PROJECTS} selected={PROJECTS.find((p) => p.id === selectedId)} onSelect={setSelectedId} />
	);
}

function currentFolder(): string | null {
	const list = screen.getByRole("list", {name: "Recent environments"});
	return (
		within(list)
			.getAllByRole("listitem")
			.find((item) => item.getAttribute("aria-current") === "true")?.textContent ?? null
	);
}

/** Press a digit with the given modifiers; returns whether the dispatcher claimed it. */
function pressDigit(digit: string, modifiers: {metaKey?: boolean; altKey?: boolean}): boolean {
	const event = new KeyboardEvent("keydown", {
		key: digit,
		code: `Digit${digit}`,
		bubbles: true,
		cancelable: true,
		...modifiers,
	});
	act(() => {
		document.body.dispatchEvent(event);
	});
	return event.defaultPrevented;
}

function useAgent(ua: string) {
	vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ua);
}

beforeEach(() => {
	useAgent(MAC_UA);
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("home environment shortcuts", () => {
	it("⌥⌘2 selects the second recent folder", () => {
		render(<Harness />);

		const claimed = pressDigit("2", {metaKey: true, altKey: true});

		expect({claimed, current: currentFolder()}).toStrictEqual({claimed: true, current: "p2"});
	});

	it("ignores a digit past the list but still claims it", () => {
		render(<Harness />);

		const claimed = pressDigit("5", {metaKey: true, altKey: true});

		expect({claimed, current: currentFolder()}).toStrictEqual({claimed: true, current: "p1"});
	});

	it("⌥⌘0 opens the Choose environment picker", async () => {
		render(<Harness />);

		const claimed = pressDigit("0", {metaKey: true, altKey: true});
		const listbox = await screen.findByRole("listbox", {name: "Projects"});

		expect({
			claimed,
			expanded: screen.getByRole("button", {name: "Choose environment"}).getAttribute("aria-expanded"),
			options: within(listbox)
				.getAllByRole("option")
				.map((o) => o.textContent),
		}).toStrictEqual({claimed: true, expanded: "true", options: ["p1", "p2", "p3"]});
	});

	it("uses Alt+digit on Windows", () => {
		useAgent(WINDOWS_UA);
		render(<Harness />);

		const claimed = pressDigit("3", {altKey: true});

		expect({claimed, current: currentFolder()}).toStrictEqual({claimed: true, current: "p3"});
	});

	it("has no binding on Linux", () => {
		useAgent(LINUX_UA);
		render(<Harness />);

		const claimed = pressDigit("3", {altKey: true});

		expect({claimed, current: currentFolder()}).toStrictEqual({claimed: false, current: "p1"});
	});

	it("is not bound without the start card", () => {
		const claimed = pressDigit("2", {metaKey: true, altKey: true});

		expect(claimed).toBe(false);
	});

	it("still works while the composer has focus", () => {
		render(
			<>
				<Harness />
				<textarea aria-label="Prompt" />
			</>,
		);
		const prompt = screen.getByRole("textbox", {name: "Prompt"});
		prompt.focus();

		const event = new KeyboardEvent("keydown", {
			key: "2",
			code: "Digit2",
			bubbles: true,
			cancelable: true,
			metaKey: true,
			altKey: true,
		});
		act(() => {
			prompt.dispatchEvent(event);
		});

		expect({claimed: event.defaultPrevented, current: currentFolder()}).toStrictEqual({
			claimed: true,
			current: "p2",
		});
	});
});
