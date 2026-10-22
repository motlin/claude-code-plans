// @vitest-environment jsdom

import {readFileSync} from "node:fs";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {act, cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {Composer} from "../src/components/composer";
import {customizeMcpServersQueryOptions} from "../src/lib/api/customize";
import {localAccountQueryOptions} from "../src/lib/api/local-account";
import type {ComposerState} from "../src/lib/composer-state";

afterEach(() => {
	cleanup();
	localStorage.clear();
	vi.useRealTimers();
});

describe("Composer", () => {
	it("uses the upstream placeholder for each variant", () => {
		const {unmount} = render(<Composer variant="session" draftKey="session-alice" onSend={() => {}} />);
		const session = screen.getByRole("textbox", {name: "Prompt"}).getAttribute("placeholder");
		unmount();
		render(<Composer variant="home" draftKey="home" onSend={() => {}} />);
		const home = screen.getByRole("textbox", {name: "Prompt"}).getAttribute("placeholder");

		expect({session, home}).toStrictEqual({
			session: "Type / for commands",
			home: "Describe a task or ask a question",
		});
	});

	it("rings the card faintly while idle and darkens the ring only while focused", () => {
		render(<Composer variant="session" draftKey="session-alice" onSend={() => {}} />);
		const card = screen.getByRole("textbox", {name: "Prompt"}).closest("[data-composer-card]")!;
		const shadowClasses = [...card.classList].filter((name) => name.includes("shadow-"));
		const styles = readFileSync("src/styles/globals.css", "utf8");
		const light = styles.slice(styles.indexOf(":root {"), styles.indexOf(".dark {"));
		const dark = styles.slice(styles.indexOf(".dark {"));
		const token = (block: string, name: string) => block.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1] ?? null;

		expect({
			shadowClasses,
			lightIdle: token(light, "--composer-shadow-idle"),
			lightFocus: token(light, "--composer-shadow-focus"),
			darkIdle: token(dark, "--composer-shadow-idle"),
			darkFocus: token(dark, "--composer-shadow-focus"),
		}).toStrictEqual({
			shadowClasses: [
				"shadow-[var(--composer-shadow-idle)]",
				"focus-within:shadow-[var(--composer-shadow-focus)]",
			],
			lightIdle: "0 4px 20px rgb(0 0 0 / 0.035), 0 0 0 1px rgb(11 11 11 / 0.1)",
			lightFocus: "0 4px 20px rgb(0 0 0 / 0.075), 0 0 0 1px rgb(11 11 11 / 0.2)",
			darkIdle: "0 4px 20px rgb(0 0 0 / 0.035), inset 0 0 0 1px rgb(255 255 255 / 0.1)",
			darkFocus: "0 4px 20px rgb(0 0 0 / 0.3), 0 0 0 1px rgb(255 255 255 / 0.2)",
		});
	});

	it("hides Send behind an aria-hidden spacer while the prompt is blank and shows it once text is typed", () => {
		const {container} = render(<Composer variant="session" draftKey="session-alice" onSend={() => {}} />);
		const slot = () => ({
			send: screen.queryByRole<HTMLButtonElement>("button", {name: "Send"})?.disabled ?? null,
			spacer: container.querySelectorAll("[data-send-spacer][aria-hidden=true][inert]").length,
		});
		const before = slot();

		fireEvent.change(screen.getByRole("textbox", {name: "Prompt"}), {
			target: {value: "   "},
		});
		const whitespace = slot();
		fireEvent.change(screen.getByRole("textbox", {name: "Prompt"}), {
			target: {value: "Continue Alice's test"},
		});

		expect({before, whitespace, after: slot()}).toStrictEqual({
			before: {send: null, spacer: 1},
			whitespace: {send: null, spacer: 1},
			after: {send: false, spacer: 0},
		});
	});

	it("sends the trimmed prompt on Enter and keeps Shift+Enter for newlines", () => {
		const onSend = vi.fn<(prompt: string) => void>();
		render(<Composer variant="session" draftKey="session-alice" onSend={onSend} />);
		const textarea = screen.getByRole<HTMLTextAreaElement>("textbox", {name: "Prompt"});

		fireEvent.change(textarea, {target: {value: "  Continue Bob's test  "}});
		fireEvent.keyDown(textarea, {key: "Enter", shiftKey: true});
		const afterShiftEnter = {calls: [...onSend.mock.calls], value: textarea.value};
		fireEvent.keyDown(textarea, {key: "Enter"});

		expect({
			afterShiftEnter,
			afterEnter: {calls: onSend.mock.calls, value: textarea.value},
		}).toStrictEqual({
			afterShiftEnter: {calls: [], value: "  Continue Bob's test  "},
			afterEnter: {calls: [["Continue Bob's test", {}]], value: ""},
		});
	});

	it("does not send while disabled", () => {
		const onSend = vi.fn<(prompt: string) => void>();
		render(<Composer variant="session" draftKey="session-alice" onSend={onSend} disabled />);
		const textarea = screen.getByRole("textbox", {name: "Prompt"});

		fireEvent.change(textarea, {target: {value: "Continue Alice's test"}});
		fireEvent.keyDown(textarea, {key: "Enter"});

		expect(onSend.mock.calls).toStrictEqual([]);
	});

	it("grows with content up to the upstream max height", () => {
		render(<Composer variant="session" draftKey="session-alice" onSend={() => {}} />);
		const textarea = screen.getByRole("textbox", {name: "Prompt"});

		expect({
			maxHeight: textarea.style.maxHeight,
			minHeight: textarea.style.minHeight,
			rows: textarea.getAttribute("rows"),
		}).toStrictEqual({
			maxHeight: "min(24rem, 40svh)",
			minHeight: "28px",
			rows: "1",
		});
	});

	it("exposes the delivery hint as the Send button description", () => {
		render(
			<Composer
				variant="session"
				draftKey="session-alice"
				onSend={() => {}}
				deliveryHint="Sends to the live terminal"
			/>,
		);
		fireEvent.change(screen.getByRole("textbox", {name: "Prompt"}), {target: {value: "Continue Alice's test"}});
		const send = screen.getByRole("button", {name: "Send"});
		const describedBy = send.getAttribute("aria-describedby") ?? "";

		expect({
			description: describedBy
				.split(" ")
				.map((id) => document.getElementById(id)?.textContent)
				.join(" "),
		}).toStrictEqual({description: "Sends to the live terminal"});
	});

	it("shows the Send ⏎ tooltip alongside the delivery hint", () => {
		vi.useFakeTimers();
		render(
			<Composer
				variant="session"
				draftKey="session-alice"
				onSend={() => {}}
				deliveryHint="Starts a forked session"
			/>,
		);
		fireEvent.change(screen.getByRole("textbox", {name: "Prompt"}), {target: {value: "Continue Alice's test"}});
		const send = screen.getByRole("button", {name: "Send"});

		fireEvent.pointerEnter(send);
		act(() => {
			vi.advanceTimersByTime(300);
		});
		const describedBy = send.getAttribute("aria-describedby") ?? "";

		expect({
			tooltip: screen.getByRole("tooltip").textContent,
			descriptionCount: describedBy.split(" ").length,
			hintKept: describedBy
				.split(" ")
				.some((id) => document.getElementById(id)?.textContent === "Starts a forked session"),
		}).toStrictEqual({tooltip: "Send⏎", descriptionCount: 2, hintKept: true});
	});

	it("relies on the global text-entry floor on coarse pointers", () => {
		render(<Composer variant="home" draftKey="home" onSend={() => {}} />);

		expect(
			screen
				.getByRole("textbox", {name: "Prompt"})
				.className.split(" ")
				.filter((token) => token.startsWith("pointer-coarse:")),
		).toStrictEqual([]);
	});

	it("swaps Send for Stop while streaming", () => {
		const onCancel = vi.fn<() => void>();
		render(
			<Composer variant="session" draftKey="session-alice" onSend={() => {}} onCancel={onCancel} isStreaming />,
		);

		fireEvent.click(screen.getByRole("button", {name: "Stop"}));

		expect({
			cancels: onCancel.mock.calls.length,
			send: screen.queryByRole("button", {name: "Send"}),
		}).toStrictEqual({cancels: 1, send: null});
	});

	describe("chin readouts", () => {
		const NOW_MS = Date.UTC(2026, 8, 29, 12, 0, 0);
		const CHIN: ComposerState = {
			mode: {id: "acceptEdits", label: "Accept edits"},
			model: "Opus 5.5",
			modelId: "claude-opus-5-5",
			effort: {id: "xhigh", label: "Extra-high"},
			usage: {
				contextTokens: 190_200,
				contextWindowSize: 1_000_000,
				contextPercent: 19,
				fiveHour: {usedPercentage: 10, resetsAt: NOW_MS / 1000 + 4 * 3600 + 11 * 60},
				weekly: {usedPercentage: 65, resetsAt: NOW_MS / 1000 + 14 * 3600 + 31 * 60},
				updatedAt: new Date(NOW_MS - 3 * 3600 * 1000).toISOString(),
			},
		};

		it("shows the mode, then the model + effort picker and the usage ring left to right", () => {
			vi.useFakeTimers({now: NOW_MS, toFake: ["Date"]});
			render(<Composer variant="session" draftKey="session-alice" onSend={() => {}} chin={CHIN} />);
			const chin = document.querySelector('[data-cds="ChatComposerChin"]');
			const labels = Array.from(chin?.querySelectorAll("[aria-label], [data-chin-mode]") ?? []).map(
				(element) => element.getAttribute("aria-label") ?? element.textContent,
			);

			expect(labels).toStrictEqual([
				"Accept edits",
				"Model: Opus 5.5, Effort: Extra",
				"Usage: Weekly · all models: 65%, Resets in 14 hr 31 min",
			]);
		});

		it("puts + inside the 44px composer card at its left edge, as upstream does", () => {
			render(<Composer variant="session" draftKey="session-alice" onSend={() => {}} chin={CHIN} />);
			const card = document.querySelector("[data-composer-card]");
			const add = screen.getByRole("button", {name: "Add"});
			expect({
				inCard: card?.contains(add),
				inChin: document.querySelector('[data-cds="ChatComposerChin"]')?.contains(add),
				slot: add
					.closest("[data-composer-add]")
					?.className.split(" ")
					.filter((name) => ["absolute", "left-0"].includes(name)),
				padding: card?.className.split(" ").includes("p-2"),
			}).toStrictEqual({inCard: true, inChin: false, slot: ["absolute", "left-0"], padding: true});
		});

		it("uses upstream's card and chin tokens: r14 p8 card, 28px Add and Send, 24px 13/20 chin controls", () => {
			render(<Composer variant="session" draftKey="session-alice" onSend={() => {}} chin={CHIN} />);
			const classes = (element: Element | null | undefined) => element?.getAttribute("class")?.split(" ") ?? [];
			const pick = (element: Element | null | undefined, tokens: readonly string[]) =>
				tokens.filter((name) => classes(element).includes(name));
			const card = document.querySelector("[data-composer-card]");
			const add = screen.getByRole("button", {name: "Add"});
			const textarea = screen.getByRole("textbox", {name: "Prompt"});
			const chin = document.querySelector('[data-cds="ChatComposerChin"]');
			const model = screen.getByRole("button", {name: /^Model:/});
			const ring = screen.getByRole("button", {name: /^Usage:/});
			const ringSvg = ring.querySelector("svg");

			expect({
				card: pick(card, ["rounded-composer", "p-2", "rounded-card", "p-2.5"]),
				add: pick(add, ["size-7", "h-6", "w-6"]),
				addIcon: pick(add.querySelector("svg"), ["size-[18px]", "size-4"]),
				addSlot: pick(add.closest("[data-composer-add]"), ["min-h-7"]),
				spacer: pick(document.querySelector("[data-send-spacer] > span"), ["size-7"]),
				editor: {
					padding: pick(textarea, ["py-1", "pl-1"]),
					minHeight: textarea.style.minHeight,
				},
				chin: pick(chin, ["mt-1.5", "min-h-6", "text-[13px]/[20px]", "text-secondary"]),
				mode: pick(document.querySelector("[data-chin-mode]"), ["h-6", "px-1.5", "text-secondary"]),
				model: {
					height: pick(model, ["h-6"]),
					parts: Array.from(model.children, (part) => ({text: part.textContent, classes: classes(part)})),
				},
				ring: {
					height: pick(ring, ["h-6", "aspect-square"]),
					svg: [ringSvg?.getAttribute("width"), ringSvg?.getAttribute("height")],
				},
			}).toStrictEqual({
				card: ["rounded-composer", "p-2"],
				add: ["size-7"],
				addIcon: ["size-[18px]"],
				addSlot: ["min-h-7"],
				spacer: ["size-7"],
				editor: {padding: ["py-1", "pl-1"], minHeight: "28px"},
				chin: ["mt-1.5", "min-h-6", "text-[13px]/[20px]", "text-secondary"],
				mode: ["h-6", "px-1.5", "text-secondary"],
				model: {
					height: ["h-6"],
					parts: [
						{text: "Opus 5.5", classes: ["truncate"]},
						{
							text: " Extra",
							classes: ["shrink-0", "whitespace-pre", "text-ink-muted", "@max-[280px]:hidden"],
						},
					],
				},
				ring: {height: ["h-6", "aspect-square"], svg: ["14", "14"]},
			});
		});

		it("draws the ring arc from the most-used plan limit on upstream's 14/r6 geometry", () => {
			render(<Composer variant="session" draftKey="session-alice" onSend={() => {}} chin={CHIN} />);
			const svg = screen.getByRole("button", {name: /^Usage:/}).querySelector("svg");
			const [track, arc] = Array.from(svg?.querySelectorAll("circle") ?? []);

			expect({
				viewBox: svg?.getAttribute("viewBox"),
				track: [track?.getAttribute("r"), track?.getAttribute("stroke")],
				arc: {
					r: arc?.getAttribute("r"),
					stroke: arc?.getAttribute("stroke"),
					dasharray: arc?.getAttribute("stroke-dasharray"),
					dashoffset: Number(arc?.getAttribute("stroke-dashoffset")).toFixed(4),
					transition: arc?.getAttribute("class"),
				},
			}).toStrictEqual({
				viewBox: "0 0 14 14",
				track: ["6", "var(--color-alpha-4)"],
				arc: {
					r: "6",
					stroke: "var(--color-fill-accent)",
					dasharray: "37.699",
					dashoffset: (0.35 * 37.699).toFixed(4),
					transition: "transition-[stroke-dashoffset] duration-300",
				},
			});
		});

		it.each([
			{weekly: 74, stroke: "var(--color-fill-accent)"},
			{weekly: 75, stroke: "var(--color-usage-warning)"},
			{weekly: 90, stroke: "var(--color-usage-danger)"},
		])("colours the arc $stroke at $weekly%", ({weekly, stroke}) => {
			const usage = CHIN.usage && {...CHIN.usage, weekly: {...CHIN.usage.weekly!, usedPercentage: weekly}};
			render(<Composer variant="session" draftKey="session-alice" onSend={() => {}} chin={{...CHIN, usage}} />);
			expect(document.querySelector("[data-usage-ring-arc]")?.getAttribute("stroke")).toBe(stroke);
		});

		const renderWithAccount = (planDetail?: string) => {
			const queryClient = new QueryClient();
			queryClient.setQueryData(localAccountQueryOptions.queryKey, {
				name: "Craig",
				firstName: "Craig",
				initial: "C",
				...(planDetail === undefined ? {} : {planDetail}),
			});
			render(
				<QueryClientProvider client={queryClient}>
					<Composer variant="session" draftKey="session-alice" onSend={() => {}} chin={CHIN} />
				</QueryClientProvider>,
			);
		};

		it("opens upstream's 2026-10-20 usage popover: plan header, Session limit and weekly meters, no context window", async () => {
			vi.useFakeTimers({now: NOW_MS, toFake: ["Date"]});
			renderWithAccount("Max (20x)");

			fireEvent.click(screen.getByRole("button", {name: /^Usage:/}));
			const dialog = await screen.findByRole("dialog");
			const group = within(dialog).getByRole("group", {name: "Usage limits"});
			const meters = within(group).getAllByRole("meter");

			expect({
				title: dialog.querySelector("h2.sr-only")?.textContent,
				header: dialog.querySelector("[data-usage-popover-header] > span")?.textContent,
				context: dialog.textContent.includes("Context window"),
				updated: dialog.textContent.includes("Last updated"),
				breakdown: within(dialog).queryByRole("button", {name: "See detailed breakdown"}),
				rows: Array.from(group.querySelectorAll("[data-usage-row]"), (row) =>
					[row.children[0], ...Array.from(row.children[1]?.children ?? [])]
						.map((cell) => cell?.textContent)
						.join(" | "),
				),
				percentsHidden: Array.from(
					group.querySelectorAll("[data-usage-row] [aria-hidden=true]"),
					(cell) => cell.textContent,
				),
				meters: meters.map((meter) => ({
					now: meter.getAttribute("aria-valuenow"),
					text: meter.getAttribute("aria-valuetext"),
					label: document.getElementById(meter.getAttribute("aria-labelledby") ?? "")?.textContent,
					description: document.getElementById(meter.getAttribute("aria-describedby") ?? "")?.textContent,
					track: meter.classList.contains("bg-alpha-2"),
					fill: (meter.firstElementChild as HTMLElement | null)?.style.transform,
				})),
				popup: [...dialog.classList].filter((name) => /^(?:w-|p-|text-\[)/.test(name)),
			}).toStrictEqual({
				title: "Usage",
				header: "Plan usage limits · Max (20x)",
				context: false,
				updated: false,
				breakdown: null,
				rows: [
					"Session limit | Resets in 4 hr 11 min | 10%",
					"Weekly · all models | Resets in 14 hr 31 min | 65%",
				],
				percentsHidden: ["10%", "65%"],
				meters: [
					{
						now: "10",
						text: "10% used",
						label: "Session limit",
						description: "Resets in 4 hr 11 min",
						track: true,
						fill: "translateX(calc(var(--_meter-dir,-1) * (100% - min(100%, max(10%, 4px)))))",
					},
					{
						now: "65",
						text: "65% used",
						label: "Weekly · all models",
						description: "Resets in 14 hr 31 min",
						track: true,
						fill: "translateX(calc(var(--_meter-dir,-1) * (100% - min(100%, max(65%, 4px)))))",
					},
				],
				popup: ["w-[360px]", "p-0", "text-[13px]/[19px]"],
			});
		});

		it("drops the plan from the usage popover header when the plan is unknown", async () => {
			renderWithAccount();

			fireEvent.click(screen.getByRole("button", {name: /^Usage:/}));
			const dialog = await screen.findByRole("dialog");

			expect(dialog.querySelector("[data-usage-popover-header] > span")?.textContent).toBe("Plan usage limits");
		});

		it("previews the most-used limit and its reset in a two-row tooltip on the ring", () => {
			vi.useFakeTimers({now: NOW_MS});
			render(<Composer variant="session" draftKey="session-alice" onSend={() => {}} chin={CHIN} />);
			const anchor = screen.getByRole("button", {name: /^Usage:/}).parentElement;
			if (anchor === null) throw new Error("ring has no tooltip anchor");

			fireEvent.pointerEnter(anchor);
			act(() => {
				vi.advanceTimersByTime(400);
			});

			expect(screen.getByRole("tooltip").textContent.split("\n")).toStrictEqual([
				"Weekly · all models: 65%",
				"Resets in 14 hr 31 min",
			]);
		});

		it("hides the ring's tooltip while the usage popover is open", () => {
			vi.useFakeTimers({now: NOW_MS});
			renderWithAccount();
			const ring = screen.getByRole("button", {name: /^Usage:/});
			const anchor = ring.parentElement;
			if (anchor === null) throw new Error("ring has no tooltip anchor");

			fireEvent.click(ring);
			fireEvent.pointerEnter(anchor);
			fireEvent.focus(ring);
			act(() => {
				vi.advanceTimersByTime(400);
			});

			expect({
				expanded: ring.getAttribute("aria-expanded"),
				tooltip: screen.queryByRole("tooltip"),
			}).toStrictEqual({
				expanded: "true",
				tooltip: null,
			});
		});

		it("links the usage popover header's gauge to Settings › Usage", async () => {
			renderWithAccount("Max (20x)");

			fireEvent.click(screen.getByRole("button", {name: /^Usage:/}));
			const dialog = await screen.findByRole("dialog");
			const link = within(dialog).getByRole("link", {name: "View usage in Settings"});

			expect({
				href: link.getAttribute("href"),
				link: link.className.match(/\bsize-5\b|\brounded-r4\b|-me-1\b/g),
				icon: link.querySelector("svg")?.classList.contains("lucide-gauge"),
				className: dialog.className.match(/rounded-\S+|max-h-\S+|overflow-\S+/g),
			}).toStrictEqual({
				href: "#settings/usage",
				link: ["-me-1", "size-5", "rounded-r4"],
				icon: true,
				className: ["max-h-[min(var(--available-height),640px)]", "overflow-y-auto", "rounded-r7"],
			});

			fireEvent.click(link);
			await waitFor(() => {
				expect(screen.queryByRole("dialog")).toBeNull();
			});
		});

		it("inserts a slash from the Add menu", async () => {
			const queryClient = new QueryClient();
			queryClient.setQueryData(customizeMcpServersQueryOptions.queryKey, []);
			render(
				<QueryClientProvider client={queryClient}>
					<Composer variant="session" draftKey="session-alice" onSend={() => {}} chin={CHIN} />
				</QueryClientProvider>,
			);

			fireEvent.click(screen.getByRole("button", {name: "Add"}));
			fireEvent.click(await screen.findByRole("menuitem", {name: "Slash commands"}));

			expect(screen.getByRole<HTMLTextAreaElement>("textbox", {name: "Prompt"}).value).toBe("/");
		});

		it("renders an empty chin without chin state", () => {
			render(<Composer variant="session" draftKey="session-alice" onSend={() => {}} />);
			expect(document.querySelector('[data-cds="ChatComposerChin"]')?.childElementCount).toBe(0);
		});
	});
});
