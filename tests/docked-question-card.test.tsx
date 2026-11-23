// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {QuestionCard} from "../src/components/question-card";
import type {QuestionLike} from "../src/lib/ask-user-question";
import type {QuestionAnswer} from "../src/lib/hook-events";

afterEach(cleanup);

const SINGLE: QuestionLike =
{
	question: "Which colour?",
	header: "Colour",
	options: [
		{
			label: "Red",
			description: "Warm",
		},
		{
			label: "Blue",
		},
		{
			label: "Green",
		},
	],
};

const SECOND: QuestionLike =
{
	question: "Which size?",
	header: "Size",
	options: [
		{
			label: "Small",
		},
		{
			label: "Large",
		},
	],
};

const MULTI: QuestionLike =
{
	question: "Which features?",
	header: "Features",
	multiSelect: true,
	options: [
		{
			label: "Coverage",
		},
		{
			label: "Watch",
		},
	],
};

const PREVIEWED: QuestionLike =
{
	question: "Which layout?",
	options: [
		{
			label: "Grid",
			preview: "grid",
		},
		{
			label: "List",
			preview: "list",
		},
	],
};

type Submit = (answers: Array<QuestionAnswer | null>) => Promise<void>;

function noSubmit(): Submit
{
	return vi.fn<Submit>(async () => {});
}

function renderDocked(questions: QuestionLike[], onSubmit: Submit | undefined = noSubmit(), draftKey?: string)
{
	return render(
		<QuestionCard
			questions={questions}
			onSubmit={onSubmit}
			presentation="dock"
			{...(draftKey === undefined
				? {}
				:
					{
						draftKey,
					})}
		/>,
	);
}

function root(): HTMLElement
{
	const found = document.querySelector<HTMLElement>("[data-approval-card-root]");
	if (found === null) throw new Error("no card root");
	return found;
}

function answers(): HTMLElement[]
{
	return Array.from(document.querySelectorAll<HTMLElement>("[data-question-answer]"));
}

function option(name: string): HTMLElement
{
	const found = answers().find((node) => node.textContent.startsWith(name));
	if (found === undefined) throw new Error(`no option ${name}`);
	return found;
}

function otherBox(): HTMLTextAreaElement
{
	return screen.getByRole<HTMLTextAreaElement>(
		"textbox",
		{
			name: "Other option",
		},
	);
}

describe("DockedQuestionCard root, as upstream's c9ed5627b panel-inactive card", () =>
{
	it("routes the dock to a labelled group root at tabindex -1 without the inline presentation attribute", () =>
	{
		renderDocked([SINGLE]);
		const group = screen.getByRole("group");
		const labelledBy = group.getAttribute("aria-labelledby") ?? "";
		expect(
			{
				tabIndex: group.getAttribute("tabindex"),
				label: document.getElementById(labelledBy)?.textContent,
				presentation: group.getAttribute("data-approval-presentation"),
				region: group.getAttribute("data-focus-region"),
				cardRoot: group.hasAttribute("data-approval-card-root"),
			},
		).toStrictEqual(
			{
				tabIndex: "-1",
				label: "Which colour?",
				presentation: null,
				region: "question",
				cardRoot: true,
			},
		);
	});

	it("keeps the inline card under the card presentation", () =>
	{
		render(<QuestionCard questions={[SINGLE]} onSubmit={noSubmit()} />);
		expect(document.querySelectorAll('[data-approval-presentation="card"]').length).toBe(1);
	});
});

describe("DockedQuestionCard root keys", () =>
{
	it("swallows an unmodified Space on the root only", () =>
	{
		renderDocked([SINGLE]);
		expect(
			{
				plain: fireEvent.keyDown(
					root(),
					{
						key: " ",
					},
				),
				ctrl: fireEvent.keyDown(
					root(),
					{
						key: " ",
						ctrlKey: true,
					},
				),
			},
		).toStrictEqual(
			{
				plain: false,
				ctrl: true,
			},
		);
	});

	it("roves from the root to the first answer on ArrowDown and to Other on ArrowUp", () =>
	{
		renderDocked([SINGLE]);
		root().focus();
		fireEvent.keyDown(
			root(),
			{
				key: "ArrowDown",
			},
		);
		const down = document.activeElement?.textContent;
		root().focus();
		fireEvent.keyDown(
			root(),
			{
				key: "ArrowUp",
			},
		);
		expect(
			{
				down,
				up: document.activeElement?.textContent,
			},
		).toStrictEqual(
			{
				down: "RedWarm",
				up: "Other",
			},
		);
	});

	it("ignores digits on the root and on the window", () =>
	{
		const onSubmit = noSubmit();
		renderDocked([MULTI], onSubmit);
		const passed = fireEvent.keyDown(
			root(),
			{
				key: "1",
			},
		);
		fireEvent.keyDown(
			window,
			{
				key: "2",
			},
		);
		expect(
			{
				passed,
				pressed: answers().map((node) => node.getAttribute("aria-pressed")),
				submitted: vi.mocked(onSubmit).mock.calls.length,
			},
		).toStrictEqual(
			{
				passed: true,
				pressed: ["false", "false", "false"],
				submitted: 0,
			},
		);
	});

	it("keeps arrows inside the Other box and hands Escape back to the root", () =>
	{
		renderDocked([SINGLE]);
		fireEvent.click(option("Other"));
		const box = otherBox();
		const before = document.activeElement === box;
		fireEvent.keyDown(
			box,
			{
				key: "ArrowDown",
			},
		);
		const after = document.activeElement === box;
		fireEvent.keyDown(
			box,
			{
				key: "Escape",
			},
		);
		expect(
			{
				before,
				after,
				escaped: document.activeElement === root(),
			},
		).toStrictEqual(
			{
				before: true,
				after: true,
				escaped: true,
			},
		);
	});

	it("has no keys while collapsed", () =>
	{
		renderDocked([SINGLE]);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "View question options",
				},
			),
		);
		root().focus();
		expect(
			{
				passed: fireEvent.keyDown(
					root(),
					{
						key: " ",
					},
				),
				focused: document.activeElement === root(),
			},
		).toStrictEqual(
			{
				passed: true,
				focused: true,
			},
		);
	});
});

describe("DockedQuestionCard option rows and clicks, as upstream's Rh7", () =>
{
	it("draws filled 5px rows with no preselect, no marks and no aria-pressed on single-select", () =>
	{
		renderDocked([SINGLE]);
		const red = option("Red");
		expect(
			{
				list: red.parentElement?.className,
				row: red.className,
				pressed: red.hasAttribute("aria-pressed"),
				description: red.querySelector(".text-footnote")?.className,
				text: red.firstElementChild?.className,
			},
		).toStrictEqual(
			{
				list: "flex flex-col gap-0.75",
				row: "flex items-center gap-sm rounded-r4 px-md py-md text-start bg-alpha-1 hover:bg-alpha-2 focus-visible:outline-hidden hide-focus-ring focus-visible:shadow-focus cursor-pointer disabled:cursor-default",
				pressed: false,
				description:
					"whitespace-pre-wrap text-footnote text-muted-as-secondary [unicode-bidi:plaintext] [text-align:-webkit-match-parent] supports-[text-align:match-parent]:[text-align:match-parent]",
				text: "relative flex min-w-0 flex-1 flex-col select-text gap-0.5",
			},
		);
	});

	it("answers a one-question single-select on one click", () =>
	{
		const onSubmit = noSubmit();
		renderDocked([SINGLE], onSubmit);
		fireEvent.click(option("Blue"));
		expect(vi.mocked(onSubmit).mock.calls).toStrictEqual([
			[
				[
					{
						selected: [1],
					},
				],
			],
		]);
	});

	it("holds the sending receipt in upstream's bare find-omitted wrapper, and drops it once the result lands", () =>
	{
		const pending = vi.fn<Submit>(async () => new Promise<void>(() => {}));
		const {rerender} = renderDocked([SINGLE], pending);
		fireEvent.click(option("Blue"));
		const sending = document.querySelector("[data-question-receipt]")?.parentElement;
		const sendingWrapper =
		{
			tag: sending?.tagName,
			findOmitted: sending?.getAttribute("data-find-omitted"),
			className: sending?.className,
		};
		rerender(
			<QuestionCard
				questions={[SINGLE]}
				onSubmit={pending}
				presentation="dock"
				answered={[
					{
						question: "Which colour?",
						answer: "Blue",
						notes: null,
					},
				]}
			/>,
		);
		expect(
			{
				sendingWrapper,
				landedOmitted:
					document.querySelector("[data-question-receipt]")?.closest("[data-find-omitted]") ?? null,
			},
		).toStrictEqual(
			{
				sendingWrapper:
				{
					tag: "DIV",
					findOmitted: "",
					className: "contents",
				},
				landedOmitted: null,
			},
		);
	});

	it("advances to the next question on one click without submitting", () =>
	{
		const onSubmit = noSubmit();
		renderDocked([SINGLE, SECOND], onSubmit);
		fireEvent.click(option("Red"));
		expect(
			{
				title: document.getElementById(root().getAttribute("aria-labelledby") ?? "")?.textContent,
				submitted: vi.mocked(onSubmit).mock.calls.length,
			},
		).toStrictEqual(
			{
				title: "Which size?",
				submitted: 0,
			},
		);
	});

	it("selects a previewed option without answering", () =>
	{
		const onSubmit = noSubmit();
		renderDocked([PREVIEWED], onSubmit);
		fireEvent.click(option("List"));
		expect(
			{
				submitted: vi.mocked(onSubmit).mock.calls.length,
				row: option("List").className.includes("[box-shadow:inset_0_0_0_1px_var(--color-fill-secondary-ring)]"),
			},
		).toStrictEqual(
			{
				submitted: 0,
				row: true,
			},
		);
	});

	it("toggles multi-select rows and highlights the last clicked one", () =>
	{
		renderDocked([MULTI]);
		fireEvent.click(option("Watch"));
		fireEvent.click(option("Watch"));
		const fill = (node: HTMLElement) =>
			node.className.split(" ").filter((name) => name.startsWith("bg-") || name.startsWith("hover:bg-"));
		expect(
			{
				pressed: option("Watch").getAttribute("aria-pressed"),
				watch: fill(option("Watch")),
				coverage: fill(option("Coverage")),
				checkbox: option("Watch").querySelector(':scope > span[data-size="sm"]')?.className,
			},
		).toStrictEqual(
			{
				pressed: "false",
				watch: ["bg-alpha-2"],
				coverage: ["bg-alpha-1", "hover:bg-alpha-2"],
				checkbox: "flex shrink-0",
			},
		);
	});
});

describe("DockedQuestionCard Other row", () =>
{
	it("always renders the Other box, out of the tab order until Other is picked", () =>
	{
		renderDocked([SINGLE]);
		const box = otherBox();
		expect(
			{
				tabIndex: box.getAttribute("tabindex"),
				placeholder: box.getAttribute("placeholder"),
				rows: box.getAttribute("rows"),
				row: box.parentElement?.className,
			},
		).toStrictEqual(
			{
				tabIndex: "-1",
				placeholder: "Type your own answer here",
				rows: "1",
				row: "flex flex-col gap-[12px] rounded-r4 px-md py-md bg-alpha-1 hover:bg-alpha-2",
			},
		);
	});

	it("picks Other when typing in its box", () =>
	{
		renderDocked([MULTI]);
		fireEvent.change(
			otherBox(),
			{
				target:
				{
					value: "x",
				},
			},
		);
		expect(option("Other").getAttribute("aria-pressed")).toBe("true");
	});

	it("focuses the box and puts it in the tab order when Other is clicked", () =>
	{
		renderDocked([SINGLE]);
		fireEvent.click(option("Other"));
		expect(
			{
				focused: document.activeElement === otherBox(),
				tabIndex: otherBox().getAttribute("tabindex"),
			},
		).toStrictEqual(
			{
				focused: true,
				tabIndex: "0",
			},
		);
	});
});

describe("DockedQuestionCard header", () =>
{
	function toggle(): HTMLElement
	{
		return screen.getByRole(
			"button",
			{
				name: "View question options",
			},
		);
	}

	/** The leading position pill before the title. */
	function pill(): Element | null
	{
		return document.querySelector("[data-question-stop-name]")?.previousElementSibling ?? null;
	}

	it("collapses the options and actions and shows the position pill", () =>
	{
		renderDocked([SINGLE, SECOND]);
		fireEvent.click(toggle());
		const collapsed =
		{
			expanded: toggle().getAttribute("aria-expanded"),
			flagged: root().hasAttribute("data-collapsed"),
			options: answers().length,
			pill: pill()?.className,
		};
		fireEvent.click(toggle());
		expect(
			{
				collapsed,
				expanded:
				{
					expanded: toggle().getAttribute("aria-expanded"),
					flagged: root().hasAttribute("data-collapsed"),
					options: answers().length,
					pill: pill(),
				},
			},
		).toStrictEqual(
			{
				collapsed:
				{
					expanded: "false",
					flagged: true,
					options: 0,
					pill: "grid shrink-0 place-items-center rounded-full bg-[var(--upstream-bg-warning)] px-sm text-caption tabular-nums text-warning",
				},
				expanded:
				{
					expanded: "true",
					flagged: false,
					options: 4,
					pill: null,
				},
			},
		);
	});

	it("moves focus from inside the card to the root on collapse", () =>
	{
		renderDocked([SINGLE]);
		option("Blue").focus();
		fireEvent.click(toggle());
		expect(document.activeElement === root()).toBe(true);
	});

	it("dismisses by answering every question with upstream's dismissed copy", () =>
	{
		const onSubmit = noSubmit();
		renderDocked([SINGLE, SECOND], onSubmit);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Dismiss question",
				},
			),
		);
		const dismissed =
		{
			selected: [],
			other: "[User dismissed — do not proceed, wait for next instruction]",
		};
		expect(vi.mocked(onSubmit).mock.calls).toStrictEqual([[[dismissed, dismissed]]]);
	});

	it("has no Dismiss while read-only", () =>
	{
		render(<QuestionCard questions={[SINGLE]} presentation="dock" />);
		expect(
			screen.queryByRole(
				"button",
				{
					name: "Dismiss question",
				},
			),
		).toBeNull();
	});
});

describe("DockedQuestionCard actions", () =>
{
	it("marks a paged card's actions and draws Submit without a keycap", () =>
	{
		renderDocked([MULTI, SINGLE]);
		const next = screen.getByRole(
			"button",
			{
				name: "Next",
			},
		);
		expect(
			{
				actions: next.parentElement?.className,
				keycap: next.querySelector("[data-cds=Shortcut]"),
				disabled: next.hasAttribute("disabled"),
				pagerNext: screen
					.getByRole(
						"button",
						{
							name: "Choose an option or skip this question",
						},
					)
					.getAttribute("aria-disabled"),
			},
		).toStrictEqual(
			{
				actions: "flex items-center justify-end gap-[8px] @container epitaxy-question-paged",
				keycap: null,
				disabled: true,
				pagerNext: "true",
			},
		);
	});

	it("marks a single question's actions solo", () =>
	{
		renderDocked([MULTI]);
		expect(
			screen.getByRole(
				"button",
				{
					name: "Submit",
				},
			).parentElement?.className,
		).toBe("flex items-center justify-end gap-[8px] @container epitaxy-question-solo");
	});
});

describe("DockedQuestionCard keyboard page change", () =>
{
	async function nextFrame()
	{
		await act(async () =>
		{
			await new Promise<void>((resolve) =>
			{
				requestAnimationFrame(() =>
				{
					resolve();
				});
			});
		});
	}

	it("focuses the next page's first option after a keyboard Next", async () =>
	{
		renderDocked([MULTI, SECOND]);
		fireEvent.click(option("Watch"));
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Next",
				},
			),
			{
				detail: 0,
			},
		);
		await nextFrame();
		expect(document.activeElement?.textContent).toBe("Small");
	});

	it("leaves focus alone after a mouse Next", async () =>
	{
		renderDocked([MULTI, SECOND]);
		fireEvent.click(option("Watch"));
		option("Watch").focus();
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Next",
				},
			),
			{
				detail: 1,
			},
		);
		await nextFrame();
		expect(document.activeElement === document.body || document.activeElement?.textContent !== "Small").toBe(true);
	});
});

describe("DockedQuestionCard draft across presentations", () =>
{
	it("opens on the inline card's page and picks", () =>
	{
		const onSubmit = noSubmit();
		const {rerender} = render(
			<QuestionCard questions={[SECOND, SINGLE]} onSubmit={onSubmit} draftKey="tool-1" presentation="card" />,
		);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Show next question",
				},
			),
		);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Green",
				},
			),
		);
		rerender(
			<QuestionCard questions={[SECOND, SINGLE]} onSubmit={onSubmit} draftKey="tool-1" presentation="dock" />,
		);
		expect(
			{
				title: document.getElementById(root().getAttribute("aria-labelledby") ?? "")?.textContent,
				selected: option("Green").className.includes(
					"[box-shadow:inset_0_0_0_1px_var(--color-fill-secondary-ring)]",
				),
			},
		).toStrictEqual(
			{
				title: "Which colour?",
				selected: true,
			},
		);
	});
});
