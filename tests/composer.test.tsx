// @vitest-environment jsdom

import {readFileSync} from "node:fs";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {act, cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {Composer} from "../src/components/composer";
import {COMPOSER_CHIN_FRAME_CLASS, COMPOSER_CHIN_ROW_CLASS} from "../src/components/composer-tokens";
import {preloadComposerSurfaces} from "../src/components/composer-surfaces-entry";
import {customizeMcpServersQueryOptions} from "../src/lib/api/customize";
import {POPOVER_SCROLL_BODY_CLASS} from "../src/components/ui/popover";
import {localAccountQueryOptions} from "../src/lib/api/local-account";
import type {ComposerState} from "../src/lib/composer-state";
import
{
	attachPendingUpload,
	refillComposer,
	requestComposerTakeBack,
	resolvePendingUpload,
	submitComposer,
} from "../src/lib/context-attach";
import {ruleStart} from "./css-rule";

afterEach(() =>
{
	cleanup();
	localStorage.clear();
	vi.useRealTimers();
});

describe("Composer", () =>
{
	it("uses the upstream placeholder for each variant", () =>
	{
		const {unmount} = render(
			<Composer
				variant="session"
				draftKey="session-alice"
				onSend={() =>
				{
				}}
			/>,
		);
		const session = screen
			.getByRole(
				"textbox",
				{
					name: "Prompt",
				},
			)
			.getAttribute("aria-placeholder");
		unmount();
		render(
			<Composer
				variant="home"
				draftKey="home"
				onSend={() =>
				{
				}}
			/>,
		);
		const home = screen
			.getByRole(
				"textbox",
				{
					name: "Prompt",
				},
			)
			.getAttribute("aria-placeholder");

		expect(
			{
				session,
				home,
			},
		).toStrictEqual(
			{
				session: "Type / for commands",
				home: "Describe a task or ask a question",
			},
		);
	});

	it("draws the placeholder as upstream's clipped overlay so it never sizes the empty editor", () =>
	{
		render(
			<Composer
				variant="home"
				draftKey="home"
				onSend={() =>
				{
				}}
			/>,
		);
		const textarea = screen.getByRole(
			"textbox",
			{
				name: "Prompt",
			},
		);
		const overlay = screen.getByTestId("composer-placeholder");
		const classes = overlay.className.split(" ");

		expect(
			{
				// Upstream c2319b8e9 marks the editor as the chat tile's focus target for the tile focus hand-off.
				focusTarget: textarea.getAttribute("data-tile-focus-target"),
				nativePlaceholder: textarea.hasAttribute("placeholder"),
				ariaPlaceholder: textarea.getAttribute("aria-placeholder"),
				text: overlay.textContent,
				ariaHidden: overlay.getAttribute("aria-hidden"),
				layout: [
					"absolute",
					"inset-y-0",
					"left-[30px]",
					"right-[30px]",
					"pointer-coarse:right-[51px]",
					"comfortable:left-[32px]",
					"comfortable:right-[32px]",
					"comfortable:pointer-coarse:right-[53px]",
					"overflow-hidden",
					"pointer-events-none",
					"text-entry-floored",
				].filter((name) => classes.includes(name)),
			},
		).toStrictEqual(
			{
				focusTarget: "",
				nativePlaceholder: false,
				ariaPlaceholder: "Describe a task or ask a question",
				text: "Describe a task or ask a question",
				ariaHidden: "true",
				layout: [
					"absolute",
					"inset-y-0",
					"left-[30px]",
					"right-[30px]",
					"pointer-coarse:right-[51px]",
					"comfortable:left-[32px]",
					"comfortable:right-[32px]",
					"comfortable:pointer-coarse:right-[53px]",
					"overflow-hidden",
					"pointer-events-none",
					"text-entry-floored",
				],
			},
		);

		fireEvent.change(
			textarea,
			{
				target:
				{
					value: "hi",
				},
			},
		);
		expect(
			{
				overlay: screen.queryByTestId("composer-placeholder"),
				ariaPlaceholder: textarea.getAttribute("aria-placeholder"),
			},
		).toStrictEqual(
			{
				overlay: null,
				ariaPlaceholder: "Describe a task or ask a question",
			},
		);
	});

	it("flips the composer's compact literals to upstream's comfortable sizes: 8px card gap, 8px cluster gaps and 8px button radii", () =>
	{
		const {container} = render(
			<Composer
				variant="session"
				draftKey="session-alice"
				onSend={() =>
				{
				}}
			/>,
		);
		fireEvent.change(
			screen.getByRole(
				"textbox",
				{
					name: "Prompt",
				},
			),
			{
				target:
				{
					value: "hi",
				},
			},
		);
		const comfortable = (element: Element | null | undefined) =>
			(element?.className ?? "").split(" ").filter((name) => name.startsWith("comfortable:"));
		const send = screen.getByRole(
			"button",
			{
				name: "Send",
			},
		);

		expect(
			{
				card: comfortable(container.querySelector("[data-cds=ChatComposer] .rounded-composer")),
				editorRow: comfortable(
					screen.getByRole(
						"textbox",
						{
							name: "Prompt",
						},
					).parentElement,
				),
				add: comfortable(
					screen.getByRole(
						"button",
						{
							name: "Add",
						},
					),
				),
				send: comfortable(send),
				sendSlot: comfortable(send.closest(".absolute")),
			},
		).toStrictEqual(
			{
				card: ["comfortable:gap-y-2"],
				editorRow: ["comfortable:pr-[32px]", "comfortable:pl-[32px]", "comfortable:pointer-coarse:pr-[53px]"],
				add: ["comfortable:rounded-r6"],
				send: ["comfortable:rounded-r6"],
				sendSlot: ["comfortable:pl-2"],
			},
		);
	});

	it("rings the card faintly while idle and darkens the ring only while focused", () =>
	{
		render(
			<Composer
				variant="session"
				draftKey="session-alice"
				onSend={() =>
				{
				}}
			/>,
		);
		const card = screen
			.getByRole(
				"textbox",
				{
					name: "Prompt",
				},
			)
			.closest("[data-composer-card]")!;
		const shadowClasses = [...card.classList].filter((name) => name.includes("shadow-"));
		const styles = readFileSync("src/styles/globals.css", "utf8");
		const light = styles.slice(ruleStart(styles, ":root"), ruleStart(styles, ".dark"));
		const dark = styles.slice(ruleStart(styles, ".dark"));
		const token = (block: string, name: string) => block.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1] ?? null;

		expect(
			{
				shadowClasses,
				lightIdle: token(light, "--composer-shadow-idle"),
				lightFocus: token(light, "--composer-shadow-focus"),
				darkIdle: token(dark, "--composer-shadow-idle"),
				darkFocus: token(dark, "--composer-shadow-focus"),
			},
		).toStrictEqual(
			{
				shadowClasses: [
					"shadow-[var(--composer-shadow-idle)]",
					"focus-within:shadow-[var(--composer-shadow-focus)]",
				],
				lightIdle: "0 4px 20px rgb(0 0 0 / 0.035), 0 0 0 1px rgb(11 11 11 / 0.1)",
				lightFocus: "0 4px 20px rgb(0 0 0 / 0.075), 0 0 0 1px rgb(11 11 11 / 0.2)",
				darkIdle: "0 4px 20px rgb(0 0 0 / 0.035), inset 0 0 0 1px rgb(255 255 255 / 0.1)",
				darkFocus: "0 4px 20px rgb(0 0 0 / 0.3), 0 0 0 1px rgb(255 255 255 / 0.2)",
			},
		);
	});

	it("hides Send behind an aria-hidden spacer while the prompt is blank and shows it once text is typed", () =>
	{
		const {container} = render(
			<Composer
				variant="session"
				draftKey="session-alice"
				onSend={() =>
				{
				}}
			/>,
		);
		const slot = () => (
		{
			send:
				screen.queryByRole<HTMLButtonElement>(
					"button",
					{
						name: "Send",
					},
				)?.disabled ?? null,
			spacer: container.querySelectorAll("[data-send-spacer][aria-hidden=true][inert]").length,
		});
		const before = slot();

		fireEvent.change(
			screen.getByRole(
				"textbox",
				{
					name: "Prompt",
				},
			),
			{
				target:
				{
					value: "   ",
				},
			},
		);
		const whitespace = slot();
		fireEvent.change(
			screen.getByRole(
				"textbox",
				{
					name: "Prompt",
				},
			),
			{
				target:
				{
					value: "Continue Alice's test",
				},
			},
		);

		expect(
			{
				before,
				whitespace,
				after: slot(),
			},
		).toStrictEqual(
			{
				before:
				{
					send: null,
					spacer: 1,
				},
				whitespace:
				{
					send: null,
					spacer: 1,
				},
				after:
				{
					send: false,
					spacer: 0,
				},
			},
		);
	});

	it("sends the trimmed prompt on Enter and keeps Shift+Enter for newlines", () =>
	{
		const onSend = vi.fn<(prompt: string) => void>();
		render(<Composer variant="session" draftKey="session-alice" onSend={onSend} />);
		const textarea = screen.getByRole<HTMLTextAreaElement>(
			"textbox",
			{
				name: "Prompt",
			},
		);

		fireEvent.change(
			textarea,
			{
				target:
				{
					value: "  Continue Bob's test  ",
				},
			},
		);
		fireEvent.keyDown(
			textarea,
			{
				key: "Enter",
				shiftKey: true,
			},
		);
		const afterShiftEnter =
		{
			calls: [...onSend.mock.calls],
			value: textarea.value,
		};
		fireEvent.keyDown(
			textarea,
			{
				key: "Enter",
			},
		);

		expect(
			{
				afterShiftEnter,
				afterEnter:
				{
					calls: onSend.mock.calls,
					value: textarea.value,
				},
			},
		).toStrictEqual(
			{
				afterShiftEnter:
				{
					calls: [],
					value: "  Continue Bob's test  ",
				},
				afterEnter:
				{
					calls: [["Continue Bob's test", {}]],
					value: "",
				},
			},
		);
	});

	it("does not send while disabled", () =>
	{
		const onSend = vi.fn<(prompt: string) => void>();
		render(<Composer variant="session" draftKey="session-alice" onSend={onSend} disabled />);
		const textarea = screen.getByRole(
			"textbox",
			{
				name: "Prompt",
			},
		);

		fireEvent.change(
			textarea,
			{
				target:
				{
					value: "Continue Alice's test",
				},
			},
		);
		fireEvent.keyDown(
			textarea,
			{
				key: "Enter",
			},
		);

		expect(onSend.mock.calls).toStrictEqual([]);
	});

	it("grows with content up to the upstream max height", () =>
	{
		render(
			<Composer
				variant="session"
				draftKey="session-alice"
				onSend={() =>
				{
				}}
			/>,
		);
		const textarea = screen.getByRole(
			"textbox",
			{
				name: "Prompt",
			},
		);

		expect(
			{
				maxHeight: textarea.style.maxHeight,
				minHeight: textarea.style.minHeight,
				rows: textarea.getAttribute("rows"),
			},
		).toStrictEqual(
			{
				maxHeight: "min(24rem, 40svh)",
				minHeight: "28px",
				rows: "1",
			},
		);
	});

	it("exposes the delivery hint as the Send button description", () =>
	{
		render(
			<Composer
				variant="session"
				draftKey="session-alice"
				onSend={() =>
				{
				}}
				deliveryHint="Sends to the live terminal"
			/>,
		);
		fireEvent.change(
			screen.getByRole(
				"textbox",
				{
					name: "Prompt",
				},
			),
			{
				target:
				{
					value: "Continue Alice's test",
				},
			},
		);
		const send = screen.getByRole(
			"button",
			{
				name: "Send",
			},
		);
		const describedBy = send.getAttribute("aria-describedby") ?? "";

		expect(
			{
				description: describedBy
					.split(" ")
					.map((id) => document.getElementById(id)?.textContent)
					.join(" "),
			},
		).toStrictEqual(
			{
				description: "Sends to the live terminal",
			},
		);
	});

	it("shows the Send ⏎ tooltip alongside the delivery hint", () =>
	{
		vi.useFakeTimers();
		render(
			<Composer
				variant="session"
				draftKey="session-alice"
				onSend={() =>
				{
				}}
				deliveryHint="Starts a forked session"
			/>,
		);
		fireEvent.change(
			screen.getByRole(
				"textbox",
				{
					name: "Prompt",
				},
			),
			{
				target:
				{
					value: "Continue Alice's test",
				},
			},
		);
		const send = screen.getByRole(
			"button",
			{
				name: "Send",
			},
		);

		fireEvent.pointerEnter(send);
		act(() =>
		{
			vi.advanceTimersByTime(300);
		});
		const describedBy = send.getAttribute("aria-describedby") ?? "";

		expect(
			{
				tooltip: screen.getByRole("tooltip").textContent,
				descriptionCount: describedBy.split(" ").length,
				hintKept: describedBy
					.split(" ")
					.some((id) => document.getElementById(id)?.textContent === "Starts a forked session"),
			},
		).toStrictEqual(
			{
				tooltip: "SendEnter",
				descriptionCount: 2,
				hintKept: true,
			},
		);
	});

	it("keeps the editor box 28 tall on coarse pointers, with the overlay aligned", async () =>
	{
		await preloadComposerSurfaces();
		render(
			<Composer
				variant="home"
				draftKey="home"
				onSend={() =>
				{
				}}
				slashCommands={[
					{
						name: "model",
						description: "Set the model",
						source: "builtin",
						argumentHint: "[model]",
					},
				]}
			/>,
		);
		const textarea = screen.getByRole(
			"textbox",
			{
				name: "Prompt",
			},
		);
		fireEvent.change(
			textarea,
			{
				target:
				{
					value: "/mo",
				},
			},
		);
		fireEvent.keyDown(
			textarea,
			{
				key: "Enter",
			},
		);
		const overlay = screen.getByTestId("slash-argument-hint").parentElement;
		const coarsePadding = (element: Element | null) =>
			(element?.className ?? "").split(" ").filter((token) => token.startsWith("pointer-coarse:py-"));

		// Upstream's coarse 22px line + 3px top and bottom = h28, same as fine 20px + py-1.
		expect(
			{
				textarea: coarsePadding(textarea),
				overlay: coarsePadding(overlay),
			},
		).toStrictEqual(
			{
				textarea: ["pointer-coarse:py-[3px]"],
				overlay: ["pointer-coarse:py-[3px]"],
			},
		);
	});

	it("swaps Send for Stop while streaming", () =>
	{
		const onCancel = vi.fn<() => void>();
		render(
			<Composer
				variant="session"
				draftKey="session-alice"
				onSend={() =>
				{
				}}
				onCancel={onCancel}
				isStreaming
			/>,
		);

		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Stop",
				},
			),
		);

		expect(
			{
				cancels: onCancel.mock.calls.length,
				send: screen.queryByRole(
					"button",
					{
						name: "Send",
					},
				),
			},
		).toStrictEqual(
			{
				cancels: 1,
				send: null,
			},
		);
	});

	describe("chin readouts", () =>
	{
		const NOW_MS = Date.UTC(2026, 8, 29, 12, 0, 0);
		const CHIN: ComposerState =
		{
			mode:
			{
				id: "acceptEdits",
				label: "Accept edits",
			},
			model: "Opus 5.5",
			modelId: "claude-opus-5-5",
			settingsModelId: "claude-opus-5-5",
			settingsDefault: null,
			availableModels: null,
			fastMode: false,
			fastModeBlocked: null,
			effort:
			{
				id: "xhigh",
				label: "Extra-high",
			},
			usage:
			{
				contextTokens: 190_200,
				contextWindowSize: 1_000_000,
				contextPercent: 19,
				fiveHour:
				{
					usedPercentage: 10,
					resetsAt: NOW_MS / 1000 + 4 * 3600 + 11 * 60,
				},
				weekly:
				{
					usedPercentage: 65,
					resetsAt: NOW_MS / 1000 + 14 * 3600 + 31 * 60,
				},
				updatedAt: new Date(NOW_MS - 3 * 3600 * 1000).toISOString(),
			},
		};

		it("shows the model + effort picker, then the mode and the usage ring, all in upstream's trailing grid", () =>
		{
			vi.useFakeTimers(
				{
					now: NOW_MS,
					toFake: ["Date"],
				},
			);
			render(
				<Composer
					variant="session"
					draftKey="session-alice"
					onSend={() =>
					{
					}}
					chin={CHIN}
				/>,
			);
			const chin = document.querySelector('[data-cds="ChatComposerChin"]');
			const labels = Array.from(chin?.querySelectorAll("[aria-label], [data-chin-mode]") ?? []).map(
				(element) => element.getAttribute("aria-label") ?? element.textContent,
			);
			const row = chin?.querySelector(":scope > div > div > [data-chin-row]");
			const [leading, trailing] = Array.from(row?.children ?? []);
			const grid = trailing?.firstElementChild;
			const ring = screen.getByRole(
				"button",
				{
					name: /^Usage:/,
				},
			);

			expect(
				{
					labels,
					chin: chin?.className,
					row: [row?.getAttribute("data-size"), row?.getAttribute("data-touch-size"), row?.className],
					leading:
					{
						className: leading?.className,
						children: Array.from(leading?.children ?? [], (child) => child.outerHTML),
					},
					trailing: trailing?.className,
					controls: Array.from(row?.querySelectorAll("button") ?? [], (button) =>
						button.getAttribute("data-cds"),
					),
					grid: grid?.className,
					gridChildren: Array.from(grid?.children ?? [], (child) =>
						child.matches('[data-cds="ModelSelector"]') ? "model" : child.className,
					),
					mode: document.querySelector("[data-chin-mode]")?.closest(".inline-flex.min-w-0") !== null,
					ringWrapper: ring.closest(".ms-px")?.parentElement === grid,
				},
			).toStrictEqual(
				{
					labels: [
						"Model: Opus 5.5 Extra",
						"Accept edits",
						"Usage: Weekly · all models: 65%, Resets in 14 hr 31 min",
					],
					chin: COMPOSER_CHIN_FRAME_CLASS,
					row: ["xs", "", `${COMPOSER_CHIN_ROW_CLASS} justify-between`],
					leading:
					{
						className: "flex items-center self-start",
						children: ['<span aria-hidden="true"></span>'],
					},
					trailing:
						"ms-auto flex min-w-0 items-center gap-1 ps-2 [--upstream-text-body:calc(0.8125rem*var(--cds-rem-scale,1))] [--upstream-leading-body:calc(1.25rem*var(--cds-rem-scale,1))]",
					controls: ["ModelSelector", "Button", "Button"],
					grid: "grid min-w-0 grid-flow-col auto-cols-[minmax(0,max-content)] items-center gap-1 compact:me-1",
					gridChildren: ["model", "inline-flex min-w-0", "flex shrink-0 ms-px", "sr-only"],
					mode: true,
					ringWrapper: true,
				},
			);
		});

		it("lays the home bar's pickers out as upstream's: model, permissions, ring, each in its surface slot", () =>
		{
			render(
				<Composer
					variant="home"
					draftKey="home-alice"
					onSend={() =>
					{
					}}
					chin={CHIN}
					environment={<span>Alice's project</span>}
				/>,
			);
			const row = screen.getByTestId("environment-bar-row");
			const pickers = row.lastElementChild;
			const model = screen.getByRole(
				"button",
				{
					name: /^Model:/,
				},
			);
			const name = model.firstElementChild?.firstElementChild;
			const SLOT = "flex empty:hidden rounded bg-[var(--epitaxy-transcript-surface,var(--color-surface-1))]";

			expect(
				{
					pickers: pickers?.className,
					order: Array.from(
						pickers?.children ?? [],
						(child) => child.getAttribute("data-testid") ?? child.className,
					),
					modelSlot: screen.getByTestId("environment-bar-model").className,
					modelWrapper: model.parentElement?.closest(`[class="${SLOT}"]`) !== null,
					mode: screen.getByTestId("environment-bar-mode").className,
					ringSlot: screen
						.getByRole(
							"button",
							{
								name: /^Usage:/,
							},
						)
						.closest(".ms-px")?.parentElement?.className,
					label: model.firstElementChild?.className,
					name: name?.className,
					effort: name?.nextElementSibling?.className,
					collapse: model.getAttribute("data-collapse"),
				},
			).toStrictEqual(
				{
					pickers: "flex grow items-center justify-end gap-x-1",
					order: ["environment-bar-model", "environment-bar-mode", SLOT],
					modelSlot: "flex items-center gap-1 empty:hidden",
					modelWrapper: true,
					mode: `${SLOT} shrink-0`,
					ringSlot: SLOT,
					label: "flex min-w-0 items-center gap-1",
					name: "text-start whitespace-nowrap supports-[min-width:calc-size(auto,size)]:line-clamp-1 supports-[min-width:calc-size(auto,size)]:break-all supports-[min-width:calc-size(auto,size)]:whitespace-normal supports-[min-width:calc-size(auto,size)]:min-w-[calc-size(max-content,min(size,10ch))]",
					effort: "shrink-0 whitespace-pre text-muted-as-secondary",
					collapse: null,
				},
			);
		});

		it("puts + inside the 44px composer card at its left edge, as upstream does", () =>
		{
			render(
				<Composer
					variant="session"
					draftKey="session-alice"
					onSend={() =>
					{
					}}
					chin={CHIN}
				/>,
			);
			const card = document.querySelector("[data-composer-card]");
			const add = screen.getByRole(
				"button",
				{
					name: "Add",
				},
			);
			expect(
				{
					inCard: card?.contains(add),
					inChin: document.querySelector('[data-cds="ChatComposerChin"]')?.contains(add),
					slot: add
						.closest("[data-composer-add]")
						?.className.split(" ")
						.filter((name) => ["absolute", "left-0"].includes(name)),
					padding: card?.className.split(" ").includes("p-2"),
				},
			).toStrictEqual(
				{
					inCard: true,
					inChin: false,
					slot: ["absolute", "left-0"],
					padding: true,
				},
			);
		});

		it("inks the Add glyph with upstream's chin icon recipe under a group/btn trigger", () =>
		{
			render(
				<Composer
					variant="session"
					draftKey="session-alice"
					onSend={() =>
					{
					}}
					chin={CHIN}
				/>,
			);
			const add = screen.getByRole(
				"button",
				{
					name: "Add",
				},
			);

			expect(
				{
					lead: add.className.split(" ").slice(0, 2),
					icon: add.querySelector("svg")?.getAttribute("class"),
				},
			).toStrictEqual(
				{
					lead: ["cds-reset", "group/btn"],
					icon: "lucide lucide-plus size-[18px] text-secondary-control group-hover/btn:text-primary group-aria-pressed/btn:text-upstream-accent group-hover/btn:group-aria-pressed/btn:text-upstream-accent",
				},
			);
		});

		it("uses upstream's card and chin tokens: r14 p8 card, 28px Add and Send, 24px 13/20 chin controls", () =>
		{
			render(
				<Composer
					variant="session"
					draftKey="session-alice"
					onSend={() =>
					{
					}}
					chin={CHIN}
				/>,
			);
			const classes = (element: Element | null | undefined) => element?.getAttribute("class")?.split(" ") ?? [];
			const pick = (element: Element | null | undefined, tokens: readonly string[]) =>
				tokens.filter((name) => classes(element).includes(name));
			const card = document.querySelector("[data-composer-card]");
			const add = screen.getByRole(
				"button",
				{
					name: "Add",
				},
			);
			const textarea = screen.getByRole(
				"textbox",
				{
					name: "Prompt",
				},
			);
			const chin = document.querySelector('[data-cds="ChatComposerChin"] [data-chin-row]');
			const model = screen.getByRole(
				"button",
				{
					name: /^Model:/,
				},
			);
			const ring = screen.getByRole(
				"button",
				{
					name: /^Usage:/,
				},
			);
			const ringSvg = ring.querySelector("svg");

			expect(
				{
					card: pick(card, ["rounded-composer", "p-2", "rounded-card", "p-2.5"]),
					add: pick(add, ["size-7", "h-6", "w-6"]),
					addIcon: pick(add.querySelector("svg"), ["size-[18px]", "size-4"]),
					addSlot: pick(add.closest("[data-composer-add]"), ["min-h-7"]),
					spacer: pick(document.querySelector("[data-send-spacer] > span"), ["size-7"]),
					editor:
					{
						padding: pick(textarea, ["py-1", "pl-1"]),
						minHeight: textarea.style.minHeight,
					},
					chin: pick(chin, ["mt-2", "min-h-6", "text-footnote", "text-secondary"]),
					mode: pick(document.querySelector("[data-chin-mode]"), ["h-6", "px-1.5", "text-secondary-control"]),
					model:
					{
						height: pick(model, ["h-6"]),
						parts: Array.from(model.firstElementChild?.children ?? [], (part) => (
						{
							text: part.textContent,
							classes: classes(part),
						})),
					},
					ring:
					{
						height: pick(ring, ["h-6", "aspect-square"]),
						svg: [ringSvg?.getAttribute("width"), ringSvg?.getAttribute("height")],
					},
				},
			).toStrictEqual(
				{
					card: ["rounded-composer", "p-2"],
					add: ["size-7"],
					addIcon: ["size-[18px]"],
					addSlot: ["min-h-7"],
					spacer: ["size-7"],
					editor:
					{
						padding: ["py-1", "pl-1"],
						minHeight: "28px",
					},
					chin: ["mt-2", "min-h-6", "text-footnote", "text-secondary"],
					mode: ["h-6", "px-1.5", "text-secondary-control"],
					model:
					{
						height: ["h-6"],
						parts: [
							{
								text: "Opus 5.5",
								classes: ["min-w-6", "truncate"],
							},
							{
								text: " Extra",
								classes: ["shrink-0", "whitespace-pre", "text-ink-muted", "ms-1"],
							},
						],
					},
					ring:
					{
						height: ["h-6", "aspect-square"],
						svg: ["14", "14"],
					},
				},
			);
		});

		it("draws the ring arc from the most-used plan limit on upstream's 14/r6 geometry", () =>
		{
			render(
				<Composer
					variant="session"
					draftKey="session-alice"
					onSend={() =>
					{
					}}
					chin={CHIN}
				/>,
			);
			const svg = screen
				.getByRole(
					"button",
					{
						name: /^Usage:/,
					},
				)
				.querySelector("svg");
			const [track, arc] = Array.from(svg?.querySelectorAll("circle") ?? []);

			expect(
				{
					viewBox: svg?.getAttribute("viewBox"),
					track: [
						track?.getAttribute("r"),
						track?.getAttribute("stroke"),
						track?.hasAttribute("data-ring-track"),
					],
					arcMarked: arc?.hasAttribute("data-ring-arc"),
					arc:
					{
						r: arc?.getAttribute("r"),
						stroke: arc?.getAttribute("stroke"),
						dasharray: arc?.getAttribute("stroke-dasharray"),
						dashoffset: Number(arc?.getAttribute("stroke-dashoffset")).toFixed(4),
						transition: arc?.getAttribute("class"),
					},
				},
			).toStrictEqual(
				{
					viewBox: "0 0 14 14",
					track: ["6", "var(--color-alpha-3)", true],
					arcMarked: true,
					arc:
					{
						r: "6",
						stroke: "var(--color-fill-accent)",
						dasharray: "37.699",
						dashoffset: (0.35 * 37.699).toFixed(4),
						transition: "transition-[stroke-dashoffset] duration-300",
					},
				},
			);
		});

		it.each([
			{
				weekly: 74,
				stroke: "var(--color-fill-accent)",
			},
			{
				weekly: 75,
				stroke: "var(--color-usage-warning)",
			},
			{
				weekly: 90,
				stroke: "var(--color-usage-danger)",
			},
		])("colours the arc $stroke at $weekly%", ({weekly, stroke}) =>
		{
			const usage = CHIN.usage &&
			{
				...CHIN.usage,
				weekly:
				{
					...CHIN.usage.weekly!,
					usedPercentage: weekly,
				},
			};
			render(
				<Composer
					variant="session"
					draftKey="session-alice"
					onSend={() =>
					{
					}}
					chin={
					{
						...CHIN,
						usage,
					}}
				/>,
			);
			expect(document.querySelector("[data-ring-arc]")?.getAttribute("stroke")).toBe(stroke);
		});

		it("rings the context window in upstream's context mode when there are no plan windows", () =>
		{
			render(
				<Composer
					variant="session"
					draftKey="session-alice"
					onSend={() =>
					{
					}}
					chin={
					{
						...CHIN,
						usage:
						{
							contextTokens: 800_000,
							contextWindowSize: 1_000_000,
							contextPercent: 80,
							fiveHour: null,
							weekly: null,
							updatedAt: new Date(NOW_MS).toISOString(),
						},
					}}
				/>,
			);
			const arc = document.querySelector("[data-ring-arc]");
			expect(
				{
					name: screen
						.getByRole(
							"button",
							{
								name: /^Usage/,
							},
						)
						.getAttribute("aria-label"),
					stroke: arc?.getAttribute("stroke"),
					dashoffset: Number(arc?.getAttribute("stroke-dashoffset")).toFixed(4),
				},
			).toStrictEqual(
				{
					name: "Usage: Context 800k / 1M (80%)",
					stroke: "var(--color-usage-warning)",
					dashoffset: (0.2 * 37.699).toFixed(4),
				},
			);
		});

		const renderWithAccount = (planDetail?: string) =>
		{
			const queryClient = new QueryClient();
			queryClient.setQueryData(
				localAccountQueryOptions.queryKey,
				{
					name: "Craig",
					firstName: "Craig",
					initial: "C",
					...(planDetail === undefined
						? {}
						:
							{
								planDetail,
							}),
				},
			);
			render(
				<QueryClientProvider client={queryClient}>
					<Composer
						variant="session"
						draftKey="session-alice"
						onSend={() =>
						{
						}}
						chin={CHIN}
					/>
				</QueryClientProvider>,
			);
		};

		it("opens upstream's 2026-10-20 usage popover: plan header, Session limit and weekly meters, no context window", async () =>
		{
			vi.useFakeTimers(
				{
					now: NOW_MS,
					toFake: ["Date"],
				},
			);
			renderWithAccount("Max (20x)");

			fireEvent.click(
				screen.getByRole(
					"button",
					{
						name: /^Usage:/,
					},
				),
			);
			const dialog = await screen.findByRole("dialog");
			const group = within(dialog).getByRole(
				"group",
				{
					name: "Usage limits",
				},
			);
			const meters = within(group).getAllByRole("meter");

			expect(
				{
					title: dialog.querySelector("h2.sr-only")?.textContent,
					header: dialog.querySelector("[data-usage-popover-header] > span")?.textContent,
					context: dialog.textContent.includes("Context window"),
					updated: dialog.textContent.includes("Last updated"),
					breakdown: within(dialog).queryByRole(
						"button",
						{
							name: "See detailed breakdown",
						},
					),
					rows: Array.from(group.querySelectorAll("[data-usage-row]"), (row) =>
						[row.children[0], ...Array.from(row.children[1]?.children ?? [])]
							.map((cell) => cell?.textContent)
							.join(" | "),
					),
					percentsHidden: Array.from(
						group.querySelectorAll("[data-usage-row] [aria-hidden=true]"),
						(cell) => cell.textContent,
					),
					meters: meters.map((meter) => (
					{
						now: meter.getAttribute("aria-valuenow"),
						text: meter.getAttribute("aria-valuetext"),
						label: document.getElementById(meter.getAttribute("aria-labelledby") ?? "")?.textContent,
						description: document.getElementById(meter.getAttribute("aria-describedby") ?? "")?.textContent,
						track: meter.classList.contains("bg-upstream-accent-pressed"),
						fill: (meter.firstElementChild as HTMLElement | null)?.style.transform,
					})),
					popup: [...dialog.classList].filter((name) => /^(?:w-|p-|text-\[|text-body$)/.test(name)),
					usageBars: [...dialog.querySelectorAll<HTMLElement>("[data-usage-bars]")].map((bars) => (
					{
						surface: bars.dataset["usageBars"],
						className: bars.className,
						parent: bars.parentElement?.className,
						crossfade: bars.hasAttribute("data-usage-bars-crossfade"),
						header: bars.querySelector("[data-usage-popover-header]") !== null,
						group: bars.contains(group),
					})),
				},
			).toStrictEqual(
				{
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
							fill: "translateX(calc(var(--_meter-dir, -1) * (100% - min(100%, max(10.0%, 4px)))))",
						},
						{
							now: "65",
							text: "65% used",
							label: "Weekly · all models",
							description: "Resets in 14 hr 31 min",
							track: true,
							fill: "translateX(calc(var(--_meter-dir, -1) * (100% - min(100%, max(65.0%, 4px)))))",
						},
					],
					popup: ["w-[360px]", "p-0", "text-body"],
					usageBars: [
						{
							surface: "popover",
							className: "contents",
							parent: "flex flex-col py-1.5",
							crossfade: true,
							header: true,
							group: true,
						},
					],
				},
			);
		});

		it("drops the plan from the usage popover header when the plan is unknown", async () =>
		{
			renderWithAccount();

			fireEvent.click(
				screen.getByRole(
					"button",
					{
						name: /^Usage:/,
					},
				),
			);
			const dialog = await screen.findByRole("dialog");

			expect(dialog.querySelector("[data-usage-popover-header] > span")?.textContent).toBe("Plan usage limits");
		});

		it("tints the usage popover's meter tracks and fills by severity with the inset ring", async () =>
		{
			const usage = CHIN.usage &&
			{
				...CHIN.usage,
				fiveHour:
				{
					...CHIN.usage.fiveHour!,
					usedPercentage: 80,
				},
				weekly:
				{
					...CHIN.usage.weekly!,
					usedPercentage: 95,
				},
			};
			render(
				<QueryClientProvider client={new QueryClient()}>
					<Composer
						variant="session"
						draftKey="session-alice"
						onSend={() =>
						{
						}}
						chin={
						{
							...CHIN,
							usage,
						}}
					/>
				</QueryClientProvider>,
			);

			fireEvent.click(
				screen.getByRole(
					"button",
					{
						name: /^Usage:/,
					},
				),
			);
			const dialog = await screen.findByRole("dialog");

			expect(
				within(dialog)
					.getAllByRole("meter")
					.map((meter) => (
					{
						variant: meter.getAttribute("data-variant"),
						track: [...meter.classList].filter((name) => name.startsWith("bg-")),
						ring: meter.style.boxShadow,
						fill: [...(meter.firstElementChild?.classList ?? [])].filter((name) => name.startsWith("bg-")),
					})),
			).toStrictEqual([
				{
					variant: "warning",
					track: ["bg-usage-track-warning"],
					ring: "inset 0 0 0 1px var(--color-alpha-1)",
					fill: ["bg-usage-warning"],
				},
				{
					variant: "danger",
					track: ["bg-usage-track-danger"],
					ring: "inset 0 0 0 1px var(--color-alpha-1)",
					fill: ["bg-usage-danger"],
				},
			]);
		});

		it("lists the model family's cached weekly row after the week, captioned while unused", async () =>
		{
			vi.useFakeTimers(
				{
					now: NOW_MS,
					toFake: ["Date"],
				},
			);
			render(
				<QueryClientProvider client={new QueryClient()}>
					<Composer
						variant="session"
						draftKey="session-alice"
						onSend={() =>
						{
						}}
						chin={
						{
							...CHIN,
							usage: CHIN.usage &&
							{
								...CHIN.usage,
								scoped: [
									{
										key: "weekly_scoped-1",
										kind: "weekly_scoped",
										label: "Weekly · Fable",
										usedPercentage: 0,
										resetsAt: null,
										modelScope: "Fable",
										surfaceScope: undefined,
									},
								],
							},
						}}
					/>
				</QueryClientProvider>,
			);

			fireEvent.click(
				screen.getByRole(
					"button",
					{
						name: /^Usage:/,
					},
				),
			);
			const group = within(await screen.findByRole("dialog")).getByRole(
				"group",
				{
					name: "Usage limits",
				},
			);

			expect(
				Array.from(group.querySelectorAll("[data-usage-row]"), (row) =>
					[row.children[0], ...Array.from(row.children[1]?.children ?? [])]
						.map((cell) => cell?.textContent)
						.join(" | "),
				),
			).toStrictEqual([
				"Session limit | Resets in 4 hr 11 min | 10%",
				"Weekly · all models | Resets in 14 hr 31 min | 65%",
				"Weekly · Fable | You haven’t used Fable yet | 0%",
			]);
		});

		it("previews the most-used limit and its reset in a two-row tooltip on the ring", () =>
		{
			vi.useFakeTimers(
				{
					now: NOW_MS,
				},
			);
			render(
				<Composer
					variant="session"
					draftKey="session-alice"
					onSend={() =>
					{
					}}
					chin={CHIN}
				/>,
			);
			const anchor = screen.getByRole(
				"button",
				{
					name: /^Usage:/,
				},
			).parentElement;
			if (anchor === null) throw new Error("ring has no tooltip anchor");

			fireEvent.pointerEnter(anchor);
			act(() =>
			{
				vi.advanceTimersByTime(400);
			});

			expect(screen.getByRole("tooltip").textContent.split("\n")).toStrictEqual([
				"Weekly · all models: 65%",
				"Resets in 14 hr 31 min",
			]);
		});

		it("hides the ring's tooltip while the usage popover is open", () =>
		{
			vi.useFakeTimers(
				{
					now: NOW_MS,
				},
			);
			renderWithAccount();
			const ring = screen.getByRole(
				"button",
				{
					name: /^Usage:/,
				},
			);
			const anchor = ring.parentElement;
			if (anchor === null) throw new Error("ring has no tooltip anchor");

			fireEvent.click(ring);
			fireEvent.pointerEnter(anchor);
			fireEvent.focus(ring);
			act(() =>
			{
				vi.advanceTimersByTime(400);
			});

			expect(
				{
					expanded: ring.getAttribute("aria-expanded"),
					tooltip: screen.queryByRole("tooltip"),
				},
			).toStrictEqual(
				{
					expanded: "true",
					tooltip: null,
				},
			);
		});

		it("links the usage popover header's See all button to Settings › Usage", async () =>
		{
			renderWithAccount("Max (20x)");

			fireEvent.click(
				screen.getByRole(
					"button",
					{
						name: /^Usage:/,
					},
				),
			);
			const dialog = await screen.findByRole("dialog");
			const link = within(dialog).getByRole(
				"link",
				{
					name: "See all usage in Settings",
				},
			);
			const group = within(dialog).getByRole(
				"group",
				{
					name: "Usage limits",
				},
			);

			expect(
				{
					href: link.getAttribute("href"),
					text: link.textContent,
					link: link.className,
					children: Array.from(link.childNodes, (node) => node.nodeName),
					icon: link.querySelector("svg")?.getAttribute("class"),
					oldLink: within(dialog).queryByRole(
						"link",
						{
							name: "View usage in Settings",
						},
					),
					header: dialog.querySelector("[data-usage-popover-header] > span")?.className,
					resets: Array.from(
						group.querySelectorAll("[data-usage-row] > span:last-child"),
						(span) => span.className,
					),
					group: group.className,
					groupChildren: Array.from(group.children, (child) => child.className),
					rows: group.firstElementChild?.querySelectorAll(":scope > div > [data-usage-row]").length,
					className: dialog.className.match(/rounded-\S+|max-h-\S+|overflow-\S+/g),
					body: dialog.firstElementChild?.className,
				},
			).toStrictEqual(
				{
					href: "#settings/usage",
					text: "See all",
					link: "-me-1 inline-flex h-5 items-center gap-1 rounded-r4 px-1.5 text-[12px]/[15px] text-primary outline-none hover:bg-alpha-1 focus-visible:bg-alpha-1",
					children: ["#text", "svg"],
					icon: "lucide lucide-arrow-right -me-1 size-3 rtl:-scale-x-100",
					oldLink: null,
					header: "text-[12px]/[15px] text-muted-as-secondary",
					resets: [
						"ms-auto flex items-baseline gap-1.5 tabular-nums text-muted-as-secondary",
						"ms-auto flex items-baseline gap-1.5 tabular-nums text-muted-as-secondary",
					],
					group: "flex flex-col gap-1.5",
					groupChildren: ["flex flex-col gap-2 px-3 pb-1"],
					rows: 2,
					className: ["max-h-[min(var(--available-height),640px)]", "rounded-r7"],
					body: POPOVER_SCROLL_BODY_CLASS,
				},
			);

			fireEvent.click(link);
			await waitFor(() =>
			{
				expect(screen.queryByRole("dialog")).toBeNull();
			});
		});

		it("inserts a slash from the Add menu", async () =>
		{
			const queryClient = new QueryClient();
			queryClient.setQueryData(customizeMcpServersQueryOptions.queryKey, []);
			render(
				<QueryClientProvider client={queryClient}>
					<Composer
						variant="session"
						draftKey="session-alice"
						onSend={() =>
						{
						}}
						chin={CHIN}
					/>
				</QueryClientProvider>,
			);

			fireEvent.click(
				screen.getByRole(
					"button",
					{
						name: "Add",
					},
				),
			);
			fireEvent.click(
				await screen.findByRole(
					"menuitem",
					{
						name: "Slash commands",
					},
				),
			);

			expect(
				screen.getByRole<HTMLTextAreaElement>(
					"textbox",
					{
						name: "Prompt",
					},
				).value,
			).toBe("/");
		});

		it("renders an empty chin without chin state", () =>
		{
			render(
				<Composer
					variant="session"
					draftKey="session-alice"
					onSend={() =>
					{
					}}
				/>,
			);
			const row = document.querySelector('[data-cds="ChatComposerChin"] [data-chin-row]');
			expect(
				{
					row: row?.className,
					children: row?.childElementCount,
				},
			).toStrictEqual(
				{
					row: `${COMPOSER_CHIN_ROW_CLASS} @max-[24rem]:px-0 justify-center`,
					children: 0,
				},
			);
		});
	});

	describe("taking a cancelled steer back", () =>
	{
		it("puts the text in an empty composer and focuses it", () =>
		{
			render(
				<Composer
					variant="session"
					draftKey="session-alice"
					onSend={() =>
					{
					}}
				/>,
			);
			const textarea = screen.getByRole<HTMLTextAreaElement>(
				"textbox",
				{
					name: "Prompt",
				},
			);
			let delivered = false;
			act(() =>
			{
				delivered = requestComposerTakeBack("session-alice", "Alice's steer");
			});
			expect(
				{
					delivered,
					other: requestComposerTakeBack("session-bob", "Bob's steer"),
					value: textarea.value,
					focused: document.activeElement === textarea,
				},
			).toStrictEqual(
				{
					delivered: true,
					other: false,
					value: "Alice's steer",
					focused: true,
				},
			);
		});

		it("merges the steer ahead of a draft, as upstream's local take-back does", () =>
		{
			render(
				<Composer
					variant="session"
					draftKey="session-alice"
					onSend={() =>
					{
					}}
				/>,
			);
			const textarea = screen.getByRole<HTMLTextAreaElement>(
				"textbox",
				{
					name: "Prompt",
				},
			);
			fireEvent.change(
				textarea,
				{
					target:
					{
						value: "Carol's draft",
					},
				},
			);
			act(() =>
			{
				requestComposerTakeBack("session-alice", "Alice's steer");
			});
			expect(textarea.value).toBe("Alice's steer\n\nCarol's draft");
		});
	});

	describe("refilling a rejected send", () =>
	{
		it("puts the rejected prompt in an empty composer and focuses it", () =>
		{
			render(
				<Composer
					variant="session"
					draftKey="s1"
					onSend={() =>
					{
					}}
				/>,
			);
			const textarea = screen.getByRole<HTMLTextAreaElement>(
				"textbox",
				{
					name: "Prompt",
				},
			);
			let refilled = false;
			act(() =>
			{
				refilled = refillComposer("s1", "hi");
			});
			expect(
				{
					refilled,
					other: refillComposer("session-bob", "Bob's prompt"),
					value: textarea.value,
					focused: document.activeElement === textarea,
				},
			).toStrictEqual(
				{
					refilled: true,
					other: false,
					value: "hi",
					focused: true,
				},
			);
		});

		it("keeps text typed while the send was in flight below the rejected prompt", () =>
		{
			render(
				<Composer
					variant="session"
					draftKey="s1"
					onSend={() =>
					{
					}}
				/>,
			);
			const textarea = screen.getByRole<HTMLTextAreaElement>(
				"textbox",
				{
					name: "Prompt",
				},
			);
			fireEvent.change(
				textarea,
				{
					target:
					{
						value: "new",
					},
				},
			);
			act(() =>
			{
				refillComposer("s1", "hi");
			});
			expect(textarea.value).toBe("hi\n\nnew");
		});
	});

	describe("refocus when the draft empties", () =>
	{
		function mountWithOutside(outside: string, draftKey = "s1")
		{
			const host = document.createElement("div");
			host.innerHTML = outside;
			document.body.append(host);
			const view = render(
				<Composer
					variant="session"
					draftKey={draftKey}
					onSend={() =>
					{
					}}
				/>,
			);
			const textarea = screen.getByRole<HTMLTextAreaElement>(
				"textbox",
				{
					name: "Prompt",
				},
			);
			const focusOutside = () =>
			{
				const target = host.querySelector<HTMLElement>("#outside");
				if (target === null) throw new Error("no #outside");
				target.focus();
			};
			return {
				...view,
				host,
				textarea,
				focusOutside,
			};
		}

		function type(textarea: HTMLTextAreaElement, value: string): void
		{
			fireEvent.change(
				textarea,
				{
					target:
					{
						value,
					},
				},
			);
		}

		afterEach(() =>
		{
			document.body.innerHTML = "";
		});

		it("takes focus back from a link when a send clears the draft", () =>
		{
			const {textarea, focusOutside} = mountWithOutside('<a id="outside" href="#x">x</a>');
			type(textarea, "hi");
			focusOutside();
			act(() =>
			{
				submitComposer("s1");
			});
			expect(
				{
					value: textarea.value,
					focused: document.activeElement === textarea,
				},
			).toStrictEqual(
				{
					value: "",
					focused: true,
				},
			);
		});

		it("leaves focus in an open menu", () =>
		{
			const {textarea, focusOutside} = mountWithOutside('<div role="menu"><button id="outside">x</button></div>');
			type(textarea, "hi");
			focusOutside();
			act(() =>
			{
				submitComposer("s1");
			});
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

		it("leaves focus in another input", () =>
		{
			const {textarea, focusOutside} = mountWithOutside('<input id="outside">');
			type(textarea, "hi");
			focusOutside();
			act(() =>
			{
				submitComposer("s1");
			});
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

		it("does not move focus when the draft changes but stays non-empty", () =>
		{
			const {textarea, focusOutside} = mountWithOutside('<a id="outside" href="#x">x</a>');
			focusOutside();
			type(textarea, "hi");
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

		it("takes focus back when a send held for an upload lands after focus moved", async () =>
		{
			const {textarea, focusOutside} = mountWithOutside('<a id="outside" href="#x">x</a>');
			type(textarea, "hi");
			let id: string | undefined;
			act(() =>
			{
				id = attachPendingUpload(
					"s1",
					{
						kind: "image",
						name: "shot.png",
						previewUrl: "blob:shot",
					},
				);
			});
			if (id === undefined) throw new Error("no pending chip");
			const pendingId = id;
			act(() =>
			{
				submitComposer("s1");
			});
			focusOutside();
			await act(async () =>
			{
				resolvePendingUpload(
					"s1",
					pendingId,
					{
						kind: "image",
						path: "/tmp/shot.png",
						name: "shot.png",
					},
				);
				await Promise.resolve();
			});
			await waitFor(() =>
			{
				expect(textarea.value).toBe("");
			});
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

		function rerenderKey(view: ReturnType<typeof mountWithOutside>, draftKey: string): void
		{
			view.rerender(
				<Composer
					variant="session"
					draftKey={draftKey}
					onSend={() =>
					{
					}}
				/>,
			);
		}

		it("a draft-key switch leaves focus in another input", () =>
		{
			const view = mountWithOutside('<input id="outside">');
			type(view.textarea, "x");
			view.focusOutside();
			rerenderKey(view, "s2");
			expect(
				{
					focusedId: document.activeElement?.id,
				},
			).toStrictEqual(
				{
					focusedId: "outside",
				},
			);
		});

		it("a draft-key switch leaves focus in a listbox", () =>
		{
			const view = mountWithOutside('<div role="listbox"><div id="outside" tabindex="-1">x</div></div>');
			view.focusOutside();
			rerenderKey(view, "s2");
			expect(
				{
					focusedId: document.activeElement?.id,
				},
			).toStrictEqual(
				{
					focusedId: "outside",
				},
			);
		});

		it("a draft-key switch on a touch screen leaves focus alone", () =>
		{
			vi.stubGlobal("matchMedia", (query: string) => (
			{
				matches: query === "(pointer: coarse)",
				media: query,
				onchange: null,
				addEventListener: () =>
				{
				},
				removeEventListener: () =>
				{
				},
				addListener: () =>
				{
				},
				removeListener: () =>
				{
				},
				dispatchEvent: () => false,
			}));
			Object.defineProperty(
				navigator,
				"maxTouchPoints",
				{
					configurable: true,
					value: 1,
				},
			);
			try
			{
				// Leaving a non-empty draft for an empty one is a swap, not an emptying change, so nothing refocuses.
				const view = mountWithOutside('<a id="outside" href="#x">x</a>');
				type(view.textarea, "x");
				view.focusOutside();
				rerenderKey(view, "s2");
				expect(
					{
						focusedId: document.activeElement?.id,
					},
				).toStrictEqual(
					{
						focusedId: "outside",
					},
				);
			}
			finally
			{
				Reflect.deleteProperty(navigator, "maxTouchPoints");
				vi.unstubAllGlobals();
			}
		});

		it("a draft-key switch takes focus from a link", () =>
		{
			const view = mountWithOutside('<a id="outside" href="#x">x</a>');
			view.focusOutside();
			rerenderKey(view, "s2");
			expect(
				{
					focused: document.activeElement === view.textarea,
				},
			).toStrictEqual(
				{
					focused: true,
				},
			);
		});
	});

	describe("send face focus handoff", () =>
	{
		type Props =
		{
			onSend?: (prompt: string) => void;
			onStop?: (() => void) | undefined;
			onCancel?: () => void;
			isStreaming?: boolean;
			disabled?: boolean;
			stopAskedAt?: number | null;
		};

		function ui(props: Props)
		{
			return (
				<div>
					<button type="button" id="outside">
						outside
					</button>
					<Composer
						variant="session"
						draftKey="handoff"
						onSend={
							props.onSend ??
							(() =>
							{
							})
						}
						{...(props.onStop === undefined
							? {}
							:
								{
									onStop: props.onStop,
								})}
						{...(props.onCancel === undefined
							? {}
							:
								{
									onCancel: props.onCancel,
								})}
						isStreaming={props.isStreaming ?? false}
						disabled={props.disabled ?? false}
						stopAskedAt={props.stopAskedAt ?? null}
					/>
				</div>
			);
		}

		function textbox(): HTMLTextAreaElement
		{
			return screen.getByRole<HTMLTextAreaElement>(
				"textbox",
				{
					name: "Prompt",
				},
			);
		}

		function type(value: string): void
		{
			fireEvent.change(
				textbox(),
				{
					target:
					{
						value,
					},
				},
			);
		}

		function keyActivate(button: HTMLElement): void
		{
			button.focus();
			fireEvent.keyDown(
				button,
				{
					key: "Enter",
				},
			);
			fireEvent.click(button);
		}

		function pointerActivate(button: HTMLElement): void
		{
			fireEvent.pointerDown(button);
			button.focus();
			fireEvent.click(button);
		}

		function pressEnter(): void
		{
			fireEvent.keyDown(
				textbox(),
				{
					key: "Enter",
				},
			);
		}

		afterEach(() =>
		{
			// Release any Enter guard a handoff left armed on the document.
			fireEvent.keyDown(
				document,
				{
					key: "Escape",
				},
			);
		});

		function sendGoesUnusable(focusSend: (send: HTMLElement) => void)
		{
			const sent: string[] = [];
			const onSend = (prompt: string) =>
			{
				sent.push(prompt);
			};
			const {rerender} = render(
				ui(
					{
						onSend,
					},
				),
			);
			type("hi");
			const send = screen.getByRole(
				"button",
				{
					name: "Send",
				},
			);
			const wrapper = send.parentElement;
			focusSend(send);
			rerender(
				ui(
					{
						onSend,
						disabled: true,
					},
				),
			);
			rerender(
				ui(
					{
						onSend,
					},
				),
			);
			const focused = document.activeElement === textbox();
			pressEnter();
			return {
				wrapper: `${wrapper?.tagName}.${wrapper?.className}`,
				focused,
				sent,
			};
		}

		it("hands a keyboard-focused Send that goes unusable to the editor and swallows the Enter that follows", () =>
		{
			expect(
				sendGoesUnusable((send) =>
				{
					send.focus();
				}),
			).toStrictEqual(
				{
					wrapper: "SPAN.contents",
					focused: true,
					sent: [],
				},
			);
		});

		it("leaves a pointer-focused Send alone and arms no Enter guard", () =>
		{
			expect(
				sendGoesUnusable((send) =>
				{
					fireEvent.pointerDown(send);
					send.focus();
				}),
			).toStrictEqual(
				{
					wrapper: "SPAN.contents",
					focused: false,
					sent: ["hi"],
				},
			);
		});

		it("hands a keyboard steer to the editor as Send gives way to Stop", () =>
		{
			const sent: string[] = [];
			render(
				ui(
					{
						onStop: () =>
						{
						},
						onSend: (prompt) =>
						{
							sent.push(prompt);
						},
					},
				),
			);
			type("steer");
			keyActivate(
				screen.getByRole(
					"button",
					{
						name: "Send",
					},
				),
			);
			expect(
				{
					focused: document.activeElement === textbox(),
					sent,
					leavingInert: screen.getByTestId("code-prompt-send").closest("[inert]") !== null,
				},
			).toStrictEqual(
				{
					focused: true,
					sent: ["steer"],
					leavingInert: true,
				},
			);
		});

		it("hands a keyboard-activated Stop to the editor when the turn stops", () =>
		{
			const stops: string[] = [];
			const onStop = () =>
			{
				stops.push("stop");
			};
			const {rerender} = render(
				ui(
					{
						onStop,
					},
				),
			);
			keyActivate(screen.getByTestId("code-prompt-stop"));
			rerender(ui({}));
			expect(
				{
					stops,
					focused: document.activeElement === textbox(),
				},
			).toStrictEqual(
				{
					stops: ["stop"],
					focused: true,
				},
			);
		});

		it("hands off after an Esc ask the host reports", () =>
		{
			const {rerender} = render(
				ui(
					{
						onStop: () =>
						{
						},
					},
				),
			);
			const stop = screen.getByTestId("code-prompt-stop");
			stop.focus();
			fireEvent.keyDown(
				stop,
				{
					key: "Escape",
				},
			);
			rerender(
				ui(
					{
						stopAskedAt: Date.now(),
					},
				),
			);
			expect(
				{
					focused: document.activeElement === textbox(),
				},
			).toStrictEqual(
				{
					focused: true,
				},
			);
		});

		it("keeps focus put when the turn ends on its own", () =>
		{
			vi.useFakeTimers(
				{
					toFake: ["setTimeout", "clearTimeout", "Date", "performance"],
				},
			);
			const {rerender} = render(
				ui(
					{
						onStop: () =>
						{
						},
					},
				),
			);
			const stop = screen.getByTestId("code-prompt-stop");
			stop.focus();
			fireEvent.keyDown(
				stop,
				{
					key: "Tab",
				},
			);
			vi.advanceTimersByTime(2000);
			rerender(ui({}));
			expect(
				{
					focused: document.activeElement === textbox(),
				},
			).toStrictEqual(
				{
					focused: false,
				},
			);
		});

		it("leaves a pointer-activated Stop alone", () =>
		{
			const {rerender} = render(
				ui(
					{
						onStop: () =>
						{
						},
					},
				),
			);
			pointerActivate(screen.getByTestId("code-prompt-stop"));
			rerender(ui({}));
			expect(
				{
					focused: document.activeElement === textbox(),
				},
			).toStrictEqual(
				{
					focused: false,
				},
			);
		});

		it("does not take focus when a streamed turn ends", () =>
		{
			const {rerender} = render(
				ui(
					{
						isStreaming: true,
						onCancel: () =>
						{
						},
					},
				),
			);
			const outside = document.getElementById("outside");
			outside?.focus();
			rerender(ui({}));
			expect(
				{
					focusedId: document.activeElement?.id,
				},
			).toStrictEqual(
				{
					focusedId: "outside",
				},
			);
		});

		function stopWhileDisabled(waitMs: number, between?: () => void): boolean
		{
			vi.useFakeTimers(
				{
					toFake: ["setTimeout", "clearTimeout", "Date", "performance"],
				},
			);
			const {rerender} = render(
				ui(
					{
						onStop: () =>
						{
						},
						disabled: true,
					},
				),
			);
			keyActivate(screen.getByTestId("code-prompt-stop"));
			rerender(
				ui(
					{
						disabled: true,
					},
				),
			);
			act(() =>
			{
				vi.advanceTimersByTime(waitMs);
			});
			between?.();
			rerender(ui({}));
			return document.activeElement === textbox();
		}

		it("lands a handoff once the disabled editor re-enables within a second", () =>
		{
			expect(
				{
					focused: stopWhileDisabled(400),
				},
			).toStrictEqual(
				{
					focused: true,
				},
			);
		});

		it("drops a handoff the editor re-enables too late for", () =>
		{
			expect(
				{
					focused: stopWhileDisabled(1200),
				},
			).toStrictEqual(
				{
					focused: false,
				},
			);
		});

		it("drops a handoff after a pointerdown", () =>
		{
			expect(
				{
					focused: stopWhileDisabled(100, () =>
					{
						fireEvent.pointerDown(document.body);
					}),
				},
			).toStrictEqual(
				{
					focused: false,
				},
			);
		});
	});
});
