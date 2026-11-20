// @vitest-environment jsdom

import {cleanup, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {SessionTitleSkeleton} from "../src/components/sidebar/session-title-skeleton";
import {Skeleton} from "../src/components/ui/skeleton";

afterEach(cleanup);

describe("SessionTitleSkeleton", () =>
{
	it("draws upstream's decorative inline Skeleton as an aria-hidden span with no role or text", () =>
	{
		const {container} = render(
			<Skeleton
				as="span"
				silent
				className="h-[1em] rounded"
				style={
				{
					width: "28ch",
				}}
			/>,
		);
		const bar = container.firstElementChild!;

		expect(
			{
				tag: bar.tagName,
				cds: bar.getAttribute("data-cds"),
				hidden: bar.getAttribute("aria-hidden"),
				role: bar.getAttribute("role"),
				text: bar.textContent,
			},
		).toStrictEqual(
			{
				tag: "SPAN",
				cds: "Skeleton",
				hidden: "true",
				role: null,
				text: "",
			},
		);
	});

	it("renders upstream's RM: a 28ch bar one row-font tall beside a single sr-only Loading status", () =>
	{
		const {container} = render(<SessionTitleSkeleton />);
		const wrapper = container.firstElementChild!;
		const [bar, status] = [...wrapper.children] as HTMLElement[];

		expect(
			{
				wrappers: container.children.length,
				wrapper: wrapper.className,
				children: wrapper.children.length,
				bar:
				{
					cds: bar!.getAttribute("data-cds"),
					hidden: bar!.getAttribute("aria-hidden"),
					className: bar!.className,
					width: bar!.style.width,
					height: bar!.style.height,
				},
				status:
				{
					role: status!.getAttribute("role"),
					className: status!.className,
					text: status!.textContent,
				},
				statuses: screen.getAllByRole("status").length,
			},
		).toStrictEqual(
			{
				wrappers: 1,
				wrapper: "inline-flex h-[1lh] items-center align-top",
				children: 2,
				bar:
				{
					cds: "Skeleton",
					hidden: "true",
					className:
						"block relative max-w-full overflow-hidden bg-[var(--skeleton-base)] after:absolute after:inset-0 after:animate-[shimmer_2s_linear_infinite] after:bg-[linear-gradient(90deg,transparent,var(--skeleton-sheen),transparent)] motion-reduce:after:hidden h-[1em] rounded",
					width: "28ch",
					height: "var(--sb-row-font, 13px)",
				},
				status:
				{
					role: "status",
					className: "sr-only",
					text: "Loading",
				},
				statuses: 1,
			},
		);
	});
});
