// @vitest-environment jsdom

import {readFileSync} from "node:fs";

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {ChapterHeading} from "../src/components/chapter-heading";

afterEach(cleanup);

function headingOf(container: HTMLElement): HTMLHeadingElement
{
	const heading = container.querySelector("h3");
	if (heading === null) throw new Error("no heading");
	return heading;
}

describe("ChapterHeading", () =>
{
	it("draws upstream's chapter h3 inside the assistant-text inset wrapper, outside any find-omitted region", () =>
	{
		const {container} = render(<ChapterHeading id="toolu_ch1" title="Staging refinement nodes" />);
		const heading = headingOf(container);

		expect(
			{
				wrapper: heading.parentElement?.className,
				className: heading.className,
				id: heading.id,
				title: heading.getAttribute("title"),
				ariaHidden: heading.getAttribute("aria-hidden"),
				text: heading.textContent,
				findOmitted: heading.closest("[data-find-omitted]"),
			},
		).toStrictEqual(
			{
				wrapper: "ps-[var(--cds-assistant-message-text-inset,0px)]",
				className: "line-clamp-2 text-body-semibold text-primary select-text scroll-mt-[56px]",
				id: "epitaxy-ch-toolu_ch1",
				title: "Staging refinement nodes",
				ariaHidden: null,
				text: "Staging refinement nodes",
				findOmitted: null,
			},
		);
	});

	it("reveals a renamed title with upstream's NA, then draws it plain again 1.5s later", () =>
	{
		vi.useFakeTimers();
		try
		{
			const view = render(<ChapterHeading id="toolu_ch1" title="Plan" />);
			const initial = headingOf(view.container).innerHTML;
			view.rerender(<ChapterHeading id="toolu_ch1" title="Ship" />);
			act(() =>
			{
				vi.advanceTimersByTime(200);
			});
			const heading = headingOf(view.container);
			const revealing =
			{
				title: heading.getAttribute("title"),
				srOnly: heading.querySelector(".sr-only")?.textContent,
				visual: heading.querySelector("[data-revealing]")?.textContent,
			};
			act(() =>
			{
				vi.advanceTimersByTime(1300);
			});
			expect(
				{
					initial,
					revealing,
					settled: headingOf(view.container).innerHTML,
				},
			).toStrictEqual(
				{
					initial: "Plan",
					revealing:
					{
						title: "Ship",
						srOnly: "Ship",
						visual: "Ship",
					},
					settled: "Ship",
				},
			);
		}
		finally
		{
			vi.useRealTimers();
		}
	});

	it("hides an empty title from assistive tech", () =>
	{
		const {container} = render(<ChapterHeading id="toolu_ch2" title="" />);
		expect(headingOf(container).getAttribute("aria-hidden")).toBe("true");
	});

	it("does not start a rename on double-click without a rename handler or with an empty title", () =>
	{
		const onRename = vi.fn<(title: string) => void>();
		const readOnly = render(<ChapterHeading id="toolu_ch1" title="Plan" />);
		fireEvent.doubleClick(headingOf(readOnly.container));
		const readOnlyInput = readOnly.container.querySelector("input");
		readOnly.unmount();
		const empty = render(<ChapterHeading id="toolu_ch2" title="" onRename={onRename} />);
		fireEvent.doubleClick(headingOf(empty.container));

		expect(
			{
				readOnlyInput,
				emptyInput: empty.container.querySelector("input"),
			},
		).toStrictEqual(
			{
				readOnlyInput: null,
				emptyInput: null,
			},
		);
	});

	it("double-click opens upstream's rename input with the title selected, and Enter commits once", () =>
	{
		const onRename = vi.fn<(title: string) => void>();
		const {container} = render(
			<ChapterHeading id="toolu_ch1" title="Staging refinement nodes" onRename={onRename} />,
		);
		fireEvent.doubleClick(headingOf(container));
		const input = screen.getByRole(
			"textbox",
			{
				name: "Chapter title",
			},
		);
		if (!(input instanceof HTMLInputElement)) throw new Error("not an input");
		const editing =
		{
			heading: input.parentElement?.className,
			headingTag: input.parentElement?.tagName,
			className: input.className,
			size: input.getAttribute("size"),
			value: input.value,
			selection: [input.selectionStart, input.selectionEnd],
			focused: document.activeElement === input,
		};
		fireEvent.change(
			input,
			{
				target:
				{
					value: "  Review the queue  ",
				},
			},
		);
		fireEvent.keyDown(
			input,
			{
				key: "Enter",
			},
		);
		fireEvent.blur(input);

		expect(
			{
				editing,
				calls: onRename.mock.calls,
				after: container.querySelector("input"),
			},
		).toStrictEqual(
			{
				editing:
				{
					heading: "text-body-semibold text-primary select-text scroll-mt-[56px]",
					headingTag: "H3",
					className:
						"min-w-0 max-w-full rounded-r2 border-0 bg-transparent p-0 outline outline-[1.5px] outline-fill-accent outline-offset-[1px] [field-sizing:content]",
					size: "24",
					value: "Staging refinement nodes",
					selection: [0, 24],
					focused: true,
				},
				calls: [["Review the queue"]],
				after: null,
			},
		);
	});

	it("clamps the input size between 10 and 40 and commits a changed value on blur but not an unchanged or blank one", () =>
	{
		const onRename = vi.fn<(title: string) => void>();
		const short = render(<ChapterHeading id="a" title="Plan" onRename={onRename} />);
		fireEvent.doubleClick(headingOf(short.container));
		const shortSize = screen.getByRole("textbox").getAttribute("size");
		fireEvent.blur(screen.getByRole("textbox"));
		short.unmount();

		const long = render(<ChapterHeading id="b" title={"x".repeat(60)} onRename={onRename} />);
		fireEvent.doubleClick(headingOf(long.container));
		const longSize = screen.getByRole("textbox").getAttribute("size");
		fireEvent.change(
			screen.getByRole("textbox"),
			{
				target:
				{
					value: "   ",
				},
			},
		);
		fireEvent.blur(screen.getByRole("textbox"));
		long.unmount();

		const blurred = render(<ChapterHeading id="c" title="Plan" onRename={onRename} />);
		fireEvent.doubleClick(headingOf(blurred.container));
		fireEvent.change(
			screen.getByRole("textbox"),
			{
				target:
				{
					value: "Ship it",
				},
			},
		);
		fireEvent.blur(screen.getByRole("textbox"));

		expect(
			{
				shortSize,
				longSize,
				calls: onRename.mock.calls,
			},
		).toStrictEqual(
			{
				shortSize: "10",
				longSize: "40",
				calls: [["Ship it"]],
			},
		);
	});

	it("Escape cancels without renaming and never reaches a document keydown listener", () =>
	{
		const onRename = vi.fn<(title: string) => void>();
		const documentKeydown = vi.fn<(event: KeyboardEvent) => void>();
		document.addEventListener("keydown", documentKeydown);
		const {container} = render(<ChapterHeading id="toolu_ch1" title="Plan" onRename={onRename} />);
		fireEvent.doubleClick(headingOf(container));
		fireEvent.change(
			screen.getByRole("textbox"),
			{
				target:
				{
					value: "Changed",
				},
			},
		);
		const notCancelled = fireEvent.keyDown(
			screen.getByRole("textbox"),
			{
				key: "Escape",
			},
		);
		document.removeEventListener("keydown", documentKeydown);

		expect(
			{
				notCancelled,
				calls: onRename.mock.calls,
				documentCalls: documentKeydown.mock.calls.length,
				input: container.querySelector("input"),
				text: headingOf(container).textContent,
			},
		).toStrictEqual(
			{
				notCancelled: false,
				calls: [],
				documentCalls: 0,
				input: null,
				text: "Plan",
			},
		);
	});
});

describe("text-body-semibold utility", () =>
{
	it("defines upstream's text-body at weight 600", () =>
	{
		const styles = readFileSync("src/styles/globals.css", "utf8").replaceAll(/\s+/g, " ");
		expect(styles).toContain(
			"--text-body-semibold: var(--upstream-text-body); --text-body-semibold--line-height: var(--upstream-leading-body); --text-body-semibold--font-weight: 600;",
		);
	});
});
