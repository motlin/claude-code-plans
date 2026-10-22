// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {useRovingToolbar} from "../src/lib/use-roving-toolbar";

function Toolbar({disabledMiddle = false, dir}: {disabledMiddle?: boolean; dir?: "rtl"}) {
	const roving = useRovingToolbar();
	return (
		<div
			role="toolbar"
			aria-label="Message actions"
			tabIndex={-1}
			dir={dir}
			style={dir ? {direction: dir} : {}}
			{...roving}
		>
			<button type="button">Copy</button>
			<button type="button" disabled={disabledMiddle}>
				Pin
			</button>
			<button type="button">Fork</button>
			<button type="button">Read aloud</button>
			<time>12:00</time>
		</div>
	);
}

const button = (name: string) => screen.getByRole("button", {name});
const tabIndexes = () => screen.getAllByRole("button").map((b) => [b.textContent, b.getAttribute("tabindex")]);

afterEach(cleanup);

describe("useRovingToolbar", () => {
	it("makes the first enabled button the single tab stop", () => {
		render(<Toolbar />);
		expect(tabIndexes()).toEqual([
			["Copy", "0"],
			["Pin", "-1"],
			["Fork", "-1"],
			["Read aloud", "-1"],
		]);
		expect(screen.getByText("12:00").hasAttribute("tabindex")).toBe(false);
	});

	it("moves with ArrowRight/ArrowLeft, wrapping and skipping disabled buttons", () => {
		render(<Toolbar disabledMiddle />);
		button("Copy").focus();
		fireEvent.keyDown(button("Copy"), {key: "ArrowRight"});
		expect(document.activeElement).toBe(button("Fork"));
		fireEvent.keyDown(button("Fork"), {key: "ArrowLeft"});
		expect(document.activeElement).toBe(button("Copy"));
		fireEvent.keyDown(button("Copy"), {key: "ArrowLeft"});
		expect(document.activeElement).toBe(button("Read aloud"));
		fireEvent.keyDown(button("Read aloud"), {key: "ArrowRight"});
		expect(document.activeElement).toBe(button("Copy"));
	});

	it("goes to the first and last button with Home and End", () => {
		render(<Toolbar />);
		button("Copy").focus();
		fireEvent.keyDown(button("Copy"), {key: "End"});
		expect(document.activeElement).toBe(button("Read aloud"));
		fireEvent.keyDown(button("Read aloud"), {key: "Home"});
		expect(document.activeElement).toBe(button("Copy"));
	});

	it("mirrors the arrows in RTL", () => {
		render(<Toolbar dir="rtl" />);
		button("Copy").focus();
		fireEvent.keyDown(button("Copy"), {key: "ArrowLeft"});
		expect(document.activeElement).toBe(button("Pin"));
		fireEvent.keyDown(button("Pin"), {key: "ArrowRight"});
		expect(document.activeElement).toBe(button("Copy"));
	});

	it("ignores modifier combinations", () => {
		render(<Toolbar />);
		button("Copy").focus();
		for (const modifier of ["altKey", "ctrlKey", "metaKey"] as const) {
			const notCancelled = fireEvent.keyDown(button("Copy"), {key: "ArrowRight", [modifier]: true});
			expect(notCancelled).toBe(true);
			expect(document.activeElement).toBe(button("Copy"));
		}
	});

	it("keeps the last focused button as the tab stop", () => {
		render(<Toolbar />);
		button("Pin").focus();
		button("Pin").blur();
		expect(tabIndexes()).toEqual([
			["Copy", "-1"],
			["Pin", "0"],
			["Fork", "-1"],
			["Read aloud", "-1"],
		]);
	});

	it("prevents Space on the toolbar itself but not on a button", () => {
		render(<Toolbar />);
		const bar = screen.getByRole("toolbar");
		expect(fireEvent.keyDown(bar, {key: " "})).toBe(false);
		expect(fireEvent.keyDown(button("Copy"), {key: " "})).toBe(true);
	});

	it("moves from the toolbar itself to the remembered tab stop", () => {
		render(<Toolbar />);
		button("Fork").focus();
		const bar = screen.getByRole("toolbar");
		bar.focus();
		fireEvent.keyDown(bar, {key: "ArrowRight"});
		expect(document.activeElement).toBe(button("Fork"));
	});
});
