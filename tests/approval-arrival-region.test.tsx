// @vitest-environment jsdom

import {act, cleanup, render} from "@testing-library/react";
import {useRef} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {ApprovalArrivalRegion} from "../src/components/approval-arrival-region";

function Harness({
	toolId,
	text,
	announceOnMount,
}: {
	toolId: string | null;
	text: string | null;
	announceOnMount?: boolean;
})
{
	const cardRef = useRef<HTMLDivElement>(null);
	return (
		<>
			<ApprovalArrivalRegion
				toolId={toolId}
				text={text}
				cardRef={cardRef}
				{...(announceOnMount === undefined
					? {}
					:
						{
							announceOnMount,
						})}
			/>
			<div ref={cardRef} data-testid="card">
				<button type="button">Allow</button>
			</div>
		</>
	);
}

function region(container: HTMLElement): HTMLElement
{
	const element = container.querySelector<HTMLElement>("[data-approval-arrival-region]");
	if (element === null) throw new Error("no arrival region");
	return element;
}

describe("ApprovalArrivalRegion, as upstream's ES arrival announcer", () =>
{
	beforeEach(() =>
	{
		vi.useFakeTimers();
	});

	afterEach(() =>
	{
		cleanup();
		vi.useRealTimers();
	});

	it("mounts an empty sr-only status span with no card", () =>
	{
		const {container} = render(<Harness toolId={null} text={null} />);
		const element = region(container);
		expect(
			{
				tag: element.tagName,
				role: element.getAttribute("role"),
				className: element.className,
				ariaLive: element.getAttribute("aria-live"),
				// Upstream's region carries only role and class; its trailing-slot ancestor keeps Find out.
				findOmitted: element.hasAttribute("data-find-omitted"),
				text: element.textContent,
			},
		).toStrictEqual(
			{
				tag: "SPAN",
				role: "status",
				className: "sr-only select-none",
				ariaLive: null,
				findOmitted: false,
				text: "",
			},
		);
	});

	it("clears the region, then reads the card's text 50ms later", () =>
	{
		const {container} = render(<Harness toolId="t1" text="Permission requested: edit" />);
		expect(region(container).textContent).toBe("");
		act(() =>
		{
			vi.advanceTimersByTime(49);
		});
		expect(region(container).textContent).toBe("");
		act(() =>
		{
			vi.advanceTimersByTime(1);
		});
		expect(region(container).textContent).toBe("Permission requested: edit");
	});

	it("does not announce the same card twice", () =>
	{
		const {container, rerender} = render(<Harness toolId="t1" text="Permission requested: edit" />);
		act(() =>
		{
			vi.advanceTimersByTime(50);
		});
		region(container).textContent = "";
		rerender(<Harness toolId="t1" text="Permission requested: edit" />);
		act(() =>
		{
			vi.advanceTimersByTime(100);
		});
		expect(region(container).textContent).toBe("");
	});

	it("empties the region for the next card, then reads it 50ms later", () =>
	{
		const {container, rerender} = render(<Harness toolId="t1" text="Permission requested: edit" />);
		act(() =>
		{
			vi.advanceTimersByTime(50);
		});
		rerender(<Harness toolId="t2" text="Permission requested: read" />);
		expect(region(container).textContent).toBe("");
		act(() =>
		{
			vi.advanceTimersByTime(50);
		});
		expect(region(container).textContent).toBe("Permission requested: read");
	});

	it("clears the region when the card goes away", () =>
	{
		const {container, rerender} = render(<Harness toolId="t1" text="Permission requested: edit" />);
		act(() =>
		{
			vi.advanceTimersByTime(50);
		});
		rerender(<Harness toolId={null} text={null} />);
		expect(region(container).textContent).toBe("");
		rerender(<Harness toolId="t1" text="Permission requested: edit" />);
		act(() =>
		{
			vi.advanceTimersByTime(50);
		});
		expect(region(container).textContent).toBe("Permission requested: edit");
	});

	it("stays quiet when focus lands in the card first, since the card's label is read", () =>
	{
		const {container, getByRole} = render(<Harness toolId="t1" text="Permission requested: edit" />);
		getByRole(
			"button",
			{
				name: "Allow",
			},
		).focus();
		act(() =>
		{
			vi.advanceTimersByTime(50);
		});
		expect(region(container).textContent).toBe("");
	});

	it("skips the card pending at mount when announceOnMount is false", () =>
	{
		const {container, rerender} = render(
			<Harness toolId="t1" text="Permission requested: edit" announceOnMount={false} />,
		);
		act(() =>
		{
			vi.advanceTimersByTime(50);
		});
		expect(region(container).textContent).toBe("");
		rerender(<Harness toolId="t2" text="Permission requested: read" announceOnMount={false} />);
		act(() =>
		{
			vi.advanceTimersByTime(50);
		});
		expect(region(container).textContent).toBe("Permission requested: read");
	});
});
