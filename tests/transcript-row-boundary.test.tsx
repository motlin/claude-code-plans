// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, within} from "@testing-library/react";
import {Component, type ReactNode} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {TranscriptRowBoundary} from "../src/components/transcript-row-boundary";

let consoleError: ReturnType<typeof vi.spyOn>;
let now = 1000;

beforeEach(() => {
	consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
	now = 1000;
	vi.spyOn(performance, "now").mockImplementation(() => now);
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

let crashSerial = 0;

/** Each test throws from its own call site name so the module-wide report dedupe sees a new crash. */
function crash(message: string): Error {
	crashSerial += 1;
	const error = new Error(message);
	error.name = `RowCrash${crashSerial}`;
	return error;
}

function Thrower({error}: {error: Error}): ReactNode {
	throw error;
}

class Outer extends Component<{children: ReactNode}, {caught: boolean}> {
	override state = {caught: false};
	static getDerivedStateFromError() {
		return {caught: true};
	}
	override render(): ReactNode {
		return this.state.caught ? <p>outer caught</p> : this.props.children;
	}
}

let root: HTMLElement = document.body;

/** Renders into a fresh container; the shared DOM pool can hold other files' leftovers in the body. */
function mount(ui: ReactNode) {
	const view = render(ui);
	root = view.container;
	return view;
}

const screen = {
	getByText: (text: string) => within(root).getByText(text),
	queryByText: (text: string) => within(root).queryByText(text),
	getAllByRole: (role: string) => within(root).getAllByRole(role),
	getByRole: (role: string, options: {name: string}) => within(root).getByRole(role, options),
	queryByRole: (role: string) => within(root).queryByRole(role),
	getByTestId: (id: string) => within(root).getByTestId(id),
};

function rowLogs(): number {
	return consoleError.mock.calls.filter((args: unknown[]) => args[0] === "[transcript-row]").length;
}

describe("TranscriptRowBoundary", () => {
	it("replaces only the crashed row with upstream's neutral banner", () => {
		const error = crash("boom");
		const {container} = mount(
			<div>
				<TranscriptRowBoundary kind="row" resetOn="a">
					<Thrower error={error} />
				</TranscriptRowBoundary>
				<span>sibling row</span>
			</div>,
		);
		expect(screen.getByText("sibling row").textContent).toEqual("sibling row");
		const wrapper = container.querySelector("[data-transcript-row-crashed]");
		expect(wrapper?.getAttribute("data-transcript-row-crashed")).toEqual("row");
		expect(wrapper?.className).toEqual("py-sm");
		const banner = wrapper?.querySelector('[data-cds="Banner"]');
		expect(banner?.getAttribute("role")).toEqual("status");
		expect(banner?.textContent).toEqual("Couldn’t load this.Try again");
		const buttons = screen.getAllByRole("button");
		expect(buttons.map((button) => button.textContent)).toEqual(["Try again"]);
		const message = screen.getByText("Couldn’t load this.");
		expect(message.id === "").toEqual(false);
		expect(buttons[0]?.getAttribute("aria-describedby")).toEqual(message.id);
		expect(screen.queryByText("boom")).toBeNull();
	});

	it("words an assistant reply's crash as a response", () => {
		mount(
			<TranscriptRowBoundary kind="reply" resetOn="a">
				<Thrower error={crash("boom")} />
			</TranscriptRowBoundary>,
		);
		expect(
			root.querySelector("[data-transcript-row-crashed]")?.getAttribute("data-transcript-row-crashed"),
		).toEqual("reply");
		expect(screen.getByText("This response didn’t load.").tagName).toEqual("SPAN");
	});

	it("rethrows a stale-chunk error to the route", () => {
		mount(
			<Outer>
				<TranscriptRowBoundary kind="row" resetOn="a">
					<Thrower error={new Error("Failed to fetch dynamically imported module: /assets/x.js")} />
				</TranscriptRowBoundary>
			</Outer>,
		);
		expect(screen.getByText("outer caught").tagName).toEqual("P");
		expect(root.querySelector("[data-transcript-row-crashed]")).toBeNull();
	});

	it("logs the same crash once", () => {
		const error = crash("boom");
		const {rerender} = mount(
			<TranscriptRowBoundary kind="row" resetOn="a">
				<Thrower error={error} />
			</TranscriptRowBoundary>,
		);
		rerender(
			<TranscriptRowBoundary kind="row" resetOn="b">
				<Thrower error={error} />
			</TranscriptRowBoundary>,
		);
		expect(screen.getByText("Couldn’t load this.").tagName).toEqual("SPAN");
		expect(rowLogs()).toEqual(1);
	});

	it("redraws the row when its data changes", () => {
		const {rerender} = mount(
			<TranscriptRowBoundary kind="row" resetOn="a">
				<Thrower error={crash("boom")} />
			</TranscriptRowBoundary>,
		);
		rerender(
			<TranscriptRowBoundary kind="row" resetOn="b">
				<span>row body</span>
			</TranscriptRowBoundary>,
		);
		expect(screen.getByText("row body").tagName).toEqual("SPAN");
	});

	it("draws the row again after Try again", () => {
		let fail = true;
		const error = crash("boom");
		function Flaky() {
			if (fail) throw error;
			return <span>row body</span>;
		}
		mount(
			<TranscriptRowBoundary kind="row" resetOn="a">
				<Flaky />
			</TranscriptRowBoundary>,
		);
		fail = false;
		fireEvent.click(screen.getByRole("button", {name: "Try again"}));
		expect(screen.getByText("row body").tagName).toEqual("SPAN");
	});

	it("drops the button when a retry crashes again within 10 seconds", () => {
		const error = crash("boom");
		const {rerender} = mount(
			<TranscriptRowBoundary kind="row" resetOn="a">
				<Thrower error={error} />
			</TranscriptRowBoundary>,
		);
		fireEvent.click(screen.getByRole("button", {name: "Try again"}));
		expect(screen.queryByRole("button")).toBeNull();
		expect(screen.getByText("Couldn’t load this.").tagName).toEqual("SPAN");

		now += 10_001;
		rerender(
			<TranscriptRowBoundary kind="row" resetOn="b">
				<Thrower error={error} />
			</TranscriptRowBoundary>,
		);
		expect(screen.getByRole("button", {name: "Try again"}).textContent).toEqual("Try again");
	});

	it("keeps the button when the retry's crash comes after 10 seconds", () => {
		let fail = true;
		const error = crash("boom");
		function Later() {
			if (fail) throw error;
			return <span>row body</span>;
		}
		const {rerender} = mount(
			<TranscriptRowBoundary kind="row" resetOn="a">
				<Later />
			</TranscriptRowBoundary>,
		);
		fail = false;
		fireEvent.click(screen.getByRole("button", {name: "Try again"}));
		now += 10_001;
		fail = true;
		rerender(
			<TranscriptRowBoundary kind="row" resetOn="a">
				<Later />
			</TranscriptRowBoundary>,
		);
		expect(screen.getByRole("button", {name: "Try again"}).textContent).toEqual("Try again");
	});

	it("returns focus to the row article after Try again", () => {
		const frames: FrameRequestCallback[] = [];
		vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
			frames.push(callback);
			return frames.length;
		});
		mount(
			<div tabIndex={-1} data-testid="article">
				<TranscriptRowBoundary kind="row" resetOn="a">
					<Thrower error={crash("boom")} />
				</TranscriptRowBoundary>
			</div>,
		);
		const article = screen.getByTestId("article");
		const focus = vi.spyOn(article, "focus");
		const button = screen.getByRole("button", {name: "Try again"});
		button.focus();
		fireEvent.click(button);
		expect(document.activeElement).toEqual(document.body);
		act(() => {
			for (const frame of frames) frame(0);
		});
		expect(focus.mock.calls).toEqual([[{preventScroll: true}]]);
		expect(document.activeElement).toEqual(article);
	});
});
