// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {type ReactNode, useEffect, useRef} from "react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {
	rovingHeir,
	TOOLBAR_ROVING_OPTIONS,
	type RovingToolbarOptions,
	useRovingToolbar,
} from "../src/lib/use-roving-toolbar";

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

/** A toolbar over the named buttons, with an outside button to blur to. */
function Bar({
	names,
	options,
	rootTabIndex = -1,
	children,
}: {
	names: string[];
	options?: RovingToolbarOptions;
	rootTabIndex?: number | null;
	children?: ReactNode;
}) {
	const roving = useRovingToolbar(options);
	return (
		<>
			<div
				role="toolbar"
				aria-label="Bar"
				{...(rootTabIndex === null ? {} : {tabIndex: rootTabIndex})}
				{...roving}
			>
				{names.map((name) => (
					<button key={name} type="button">
						{name}
					</button>
				))}
				{children}
			</div>
			<button type="button">Outside</button>
		</>
	);
}

const button = (name: string) => screen.getByRole("button", {name});
const tabIndexes = () => screen.getAllByRole("button").map((b) => [b.textContent, b.getAttribute("tabindex")]);
const barStops = () =>
	Array.from(screen.getByRole("toolbar").querySelectorAll("button")).map((b) => [
		b.textContent,
		b.getAttribute("tabindex"),
	]);

/** Lets the MutationObserver and the focusout microtasks run. */
async function flush() {
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
}

/** Stubs `:focus-visible` (keyboard modality when true) and a focused document. */
function stubModality(focusVisible: boolean) {
	const matches = Element.prototype.matches;
	vi.spyOn(Element.prototype, "matches").mockImplementation(function (this: Element, selector: string) {
		return selector === ":focus-visible" ? focusVisible : matches.call(this, selector);
	});
	vi.spyOn(document, "hasFocus").mockReturnValue(true);
}

/** Installs a ResizeObserver whose callbacks run on demand, and a synchronous requestAnimationFrame. */
function stubResizeObserver() {
	const callbacks: (() => void)[] = [];
	class FakeResizeObserver {
		constructor(callback: () => void) {
			callbacks.push(callback);
		}
		observe() {}
		unobserve() {}
		disconnect() {}
	}
	vi.stubGlobal("ResizeObserver", FakeResizeObserver);
	vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
		callback(0);
		return 1;
	});
	return () => {
		for (const callback of callbacks) callback();
	};
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

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

	it("lets Space through on the toolbar itself without restOnLoss, and on a button", () => {
		render(<Toolbar />);
		const bar = screen.getByRole("toolbar");
		expect({
			onBar: fireEvent.keyDown(bar, {key: " "}),
			onButton: fireEvent.keyDown(button("Copy"), {key: " "}),
		}).toEqual({onBar: true, onButton: true});
	});

	it("moves from the unparked toolbar itself to the first visible item, as upstream's c(e)", () => {
		render(<Toolbar />);
		button("Fork").focus();
		const bar = screen.getByRole("toolbar");
		bar.focus();
		fireEvent.keyDown(bar, {key: "ArrowRight"});
		expect(document.activeElement).toBe(button("Copy"));
	});

	it("exports upstream's tu options with every option on", () => {
		expect(TOOLBAR_ROVING_OPTIONS).toStrictEqual({
			watchHidden: true,
			softDisabled: true,
			portaledItems: true,
			firstUntilFocused: true,
			standInFields: true,
			restOnLoss: true,
			plainWhileEmpty: true,
		});
	});
});

describe("rovingHeir (upstream h8)", () => {
	it("takes the survivor at the stop's index, else the one before it", () => {
		const make = (name: string) => {
			const element = document.createElement("button");
			element.textContent = name;
			return element;
		};
		const [a, b, c, d] = [make("A"), make("B"), make("C"), make("D")];
		expect({
			middle: rovingHeir([a, b, c, d], c, [a, b, d])?.textContent,
			last: rovingHeir([a, b, c, d], d, [a, b, c])?.textContent,
			first: rovingHeir([a, b], a, [b])?.textContent,
		}).toStrictEqual({middle: "D", last: "C", first: "B"});
	});
});

describe("item set (upstream Dl)", () => {
	it("takes links and role=button, skipping aria-hidden and inert buttons", () => {
		function Mixed() {
			const roving = useRovingToolbar();
			return (
				<div role="toolbar" aria-label="Mixed" {...roving}>
					<a href="#x">Link</a>
					{/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- an upstream item kind under test */}
					<span role="button" tabIndex={0}>
						Span
					</span>
					{/* oxlint-disable-next-line jsx-a11y/no-aria-hidden-on-focusable -- an upstream skip case under test */}
					<button type="button" aria-hidden="true">
						Hidden
					</button>
					<div inert>
						<button type="button">Inert</button>
					</div>
				</div>
			);
		}
		const {container} = render(<Mixed />);
		const tab = (selector: string) => container.querySelector(selector)!.getAttribute("tabindex");
		expect({
			link: tab("a"),
			span: tab("span"),
			hidden: tab("[aria-hidden]"),
			inert: tab("[inert] button"),
		}).toStrictEqual({link: "0", span: "-1", hidden: null, inert: null});
	});

	it("keeps the innermost item when items nest", () => {
		function Nested() {
			const roving = useRovingToolbar();
			return (
				<div role="toolbar" aria-label="Nested" {...roving}>
					{/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a nesting wrapper under test */}
					<span tabIndex={0} data-testid="wrap">
						<button type="button">X</button>
					</span>
					<button type="button">Y</button>
				</div>
			);
		}
		render(<Nested />);
		button("Y").focus();
		fireEvent.keyDown(button("Y"), {key: "Home"});
		expect({
			x: button("X").getAttribute("tabindex"),
			focused: document.activeElement?.textContent,
			span: screen.getByTestId("wrap").getAttribute("tabindex"),
		}).toStrictEqual({x: "0", focused: "X", span: "0"});
	});

	it("leaves ArrowRight to a text field inside the toolbar", () => {
		render(
			<Bar names={["A", "B"]}>
				<input aria-label="Name" />
			</Bar>,
		);
		const input = screen.getByRole("textbox");
		input.focus();
		expect({notCancelled: fireEvent.keyDown(input, {key: "ArrowRight"}), focused: document.activeElement}).toEqual({
			notCancelled: true,
			focused: input,
		});
	});

	it("does not rove from inside a nested radiogroup", () => {
		render(
			<Bar names={["A"]}>
				<div role="radiogroup" aria-label="Pick">
					<button type="button">R1</button>
				</div>
			</Bar>,
		);
		button("R1").focus();
		fireEvent.keyDown(button("R1"), {key: "ArrowRight"});
		expect(document.activeElement).toBe(button("R1"));
	});

	it("ignores a keydown a child already defaultPrevented", () => {
		render(<Bar names={["A", "B"]} />);
		button("A").focus();
		button("A").addEventListener("keydown", (event) => {
			event.preventDefault();
		});
		fireEvent.keyDown(button("A"), {key: "ArrowRight"});
		expect(document.activeElement).toBe(button("A"));
	});
});

describe("visible-only movement and watchHidden", () => {
	it("skips a hidden item with the arrows", () => {
		render(<Bar names={["A", "B", "C"]} />);
		button("B").checkVisibility = () => false;
		button("A").focus();
		fireEvent.keyDown(button("A"), {key: "ArrowRight"});
		expect(document.activeElement).toBe(button("C"));
	});

	it("moves a hidden stop to the next visible item when the ResizeObserver fires after a blur to <body> (watchHidden)", () => {
		const fire = stubResizeObserver();
		render(<Bar names={["A", "B", "C"]} options={TOOLBAR_ROVING_OPTIONS} />);
		button("B").focus();
		button("B").blur();
		button("B").checkVisibility = () => false;
		fire();
		expect(barStops()).toEqual([
			["A", "-1"],
			["B", "-1"],
			["C", "0"],
		]);
	});

	it("keeps a hidden stop without watchHidden", () => {
		const fire = stubResizeObserver();
		render(<Bar names={["A", "B", "C"]} />);
		button("B").focus();
		button("Outside").focus();
		button("B").checkVisibility = () => false;
		fire();
		expect(barStops()).toEqual([
			["A", "-1"],
			["B", "0"],
			["C", "-1"],
		]);
	});
});

describe("neighbour heir when the stop leaves", () => {
	it("hands the stop to the item that took its index (message bars: no options)", async () => {
		const {rerender} = render(<Bar names={["A", "B", "C", "D"]} />);
		button("C").focus();
		button("Outside").focus();
		rerender(<Bar names={["A", "B", "D"]} />);
		await flush();
		expect(barStops()).toEqual([
			["A", "-1"],
			["B", "-1"],
			["D", "0"],
		]);
	});

	it("keeps the neighbour under firstUntilFocused while the ResizeObserver exists, then the one before", async () => {
		stubResizeObserver();
		const {rerender} = render(<Bar names={["A", "B", "C", "D"]} options={TOOLBAR_ROVING_OPTIONS} />);
		button("C").focus();
		button("Outside").focus();
		rerender(<Bar names={["A", "B", "D"]} options={TOOLBAR_ROVING_OPTIONS} />);
		await flush();
		const afterC = barStops();
		rerender(<Bar names={["A", "B"]} options={TOOLBAR_ROVING_OPTIONS} />);
		await flush();
		expect({afterC, afterD: barStops()}).toEqual({
			afterC: [
				["A", "-1"],
				["B", "-1"],
				["D", "0"],
			],
			afterD: [
				["A", "-1"],
				["B", "0"],
			],
		});
	});

	it("falls back to the first item under firstUntilFocused without a ResizeObserver", async () => {
		vi.stubGlobal("ResizeObserver", undefined);
		const {rerender} = render(<Bar names={["A", "B", "C", "D"]} options={TOOLBAR_ROVING_OPTIONS} />);
		button("C").focus();
		button("Outside").focus();
		rerender(<Bar names={["A", "B", "D"]} options={TOOLBAR_ROVING_OPTIONS} />);
		await flush();
		expect(barStops()).toEqual([
			["A", "0"],
			["B", "-1"],
			["D", "-1"],
		]);
	});
});

describe("focus heir when the focused item is lost (restOnLoss off)", () => {
	it("keyboard: moves focus to the item that took its index", async () => {
		stubModality(true);
		const {rerender} = render(<Bar names={["A", "B", "C"]} />);
		button("B").focus();
		rerender(<Bar names={["A", "C"]} />);
		await flush();
		expect({focused: document.activeElement?.textContent, stops: barStops()}).toEqual({
			focused: "C",
			stops: [
				["A", "-1"],
				["C", "0"],
			],
		});
	});

	it("keyboard: moves focus to the one before when the last item goes", async () => {
		stubModality(true);
		const {rerender} = render(<Bar names={["A", "B", "C"]} />);
		button("C").focus();
		rerender(<Bar names={["A", "B"]} />);
		await flush();
		expect(document.activeElement?.textContent).toBe("B");
	});

	it("pointer: parks focus silently on the root, keeping its tabindex -1 and the heir as the stop", async () => {
		stubModality(false);
		const {rerender} = render(<Bar names={["A", "B", "C"]} />);
		button("B").focus();
		rerender(<Bar names={["A", "C"]} />);
		await flush();
		const root = screen.getByRole("toolbar");
		expect({
			focusedRoot: document.activeElement === root,
			rootTabIndex: root.getAttribute("tabindex"),
			stops: barStops(),
		}).toEqual({
			focusedRoot: true,
			rootTabIndex: "-1",
			stops: [
				["A", "-1"],
				["C", "0"],
			],
		});
	});
});

describe("rest on loss", () => {
	it("parks focus on the root with an added tabindex 0, every item -1; blur ends it; Space is swallowed", async () => {
		stubModality(true);
		const {rerender} = render(<Bar names={["A", "B", "C"]} options={TOOLBAR_ROVING_OPTIONS} rootTabIndex={null} />);
		button("B").focus();
		rerender(<Bar names={["A", "C"]} options={TOOLBAR_ROVING_OPTIONS} rootTabIndex={null} />);
		await flush();
		const root = screen.getByRole("toolbar");
		const parked = {
			focusedRoot: document.activeElement === root,
			rootTabIndex: root.getAttribute("tabindex"),
			stops: barStops(),
			spaceNotCancelled: fireEvent.keyDown(root, {key: " "}),
		};
		root.blur();
		await flush();
		expect({parked, after: {rootTabIndex: root.getAttribute("tabindex"), stops: barStops()}}).toEqual({
			parked: {
				focusedRoot: true,
				rootTabIndex: "0",
				stops: [
					["A", "-1"],
					["C", "-1"],
				],
				spaceNotCancelled: false,
			},
			after: {
				rootTabIndex: null,
				stops: [
					["A", "0"],
					["C", "-1"],
				],
			},
		});
	});

	it("moves from the parked root to the heir with ArrowRight", async () => {
		stubModality(true);
		const {rerender} = render(<Bar names={["A", "B", "C"]} options={TOOLBAR_ROVING_OPTIONS} rootTabIndex={null} />);
		button("B").focus();
		rerender(<Bar names={["A", "C"]} options={TOOLBAR_ROVING_OPTIONS} rootTabIndex={null} />);
		await flush();
		fireEvent.keyDown(screen.getByRole("toolbar"), {key: "ArrowRight"});
		expect(document.activeElement?.textContent).toBe("C");
	});
});

describe("stand-in fields", () => {
	function Titled({renaming, title}: {renaming: boolean; title: string}) {
		const roving = useRovingToolbar(TOOLBAR_ROVING_OPTIONS);
		return (
			<>
				<div role="toolbar" aria-label="Session tools" {...roving}>
					<button type="button">Lead</button>
					{renaming ? (
						// oxlint-disable-next-line jsx-a11y/no-autofocus -- the rename field takes focus, as upstream's
						<input aria-label="Rename" autoFocus defaultValue={title} />
					) : (
						<button key={title} type="button">
							{title}
						</button>
					)}
					<button type="button">Trail</button>
				</div>
				<button type="button">Outside</button>
			</>
		);
	}

	it("re-elects the item where the field stood after a rename, not the first", async () => {
		stubResizeObserver();
		const {rerender} = render(<Titled renaming={false} title="Old" />);
		button("Old").focus();
		rerender(<Titled renaming title="Old" />);
		await flush();
		rerender(<Titled renaming={false} title="New" />);
		await flush();
		expect(barStops()).toEqual([
			["Lead", "-1"],
			["New", "0"],
			["Trail", "-1"],
		]);
	});
});

describe("portaled forwarding", () => {
	function Stopper({options}: {options?: RovingToolbarOptions}) {
		const stopper = useRef<HTMLButtonElement>(null);
		useEffect(() => {
			const element = stopper.current!;
			const stop = (event: KeyboardEvent) => {
				event.stopPropagation();
			};
			element.addEventListener("keydown", stop);
			return () => {
				element.removeEventListener("keydown", stop);
			};
		}, []);
		const roving = useRovingToolbar(options);
		return (
			<div role="toolbar" aria-label="Bar" {...roving}>
				<button ref={stopper} type="button">
					A
				</button>
				<button type="button">B</button>
			</div>
		);
	}

	it("still roves when a descendant stops an arrow's propagation (portaledItems)", () => {
		render(<Stopper options={TOOLBAR_ROVING_OPTIONS} />);
		button("A").focus();
		fireEvent.keyDown(button("A"), {key: "ArrowRight"});
		expect(document.activeElement?.textContent).toBe("B");
	});

	it("does not forward without portaledItems", () => {
		render(<Stopper />);
		button("A").focus();
		fireEvent.keyDown(button("A"), {key: "ArrowRight"});
		expect(document.activeElement?.textContent).toBe("A");
	});
});
