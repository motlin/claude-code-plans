// @vitest-environment jsdom

import {act, cleanup, render} from "@testing-library/react";
import {renderToStaticMarkup} from "react-dom/server";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {AnimatedDiffStat, DiffStat} from "../src/components/diff-stat";
import {type FrameQueue, installFrameQueue, stubReducedMotion} from "./helpers/frame-queue";
import {compileAll} from "./helpers/tailwind-design-system";

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("DiffStat", () => {
	it("renders upstream's et block with grouped digits and a real-count sr line", () => {
		expect(renderToStaticMarkup(<DiffStat added={1234} removed={5} className="flex" />)).toStrictEqual(
			'<span dir="ltr" class="tabular-nums flex"><span class="sr-only">1,234 additions, 5 deletions</span><span aria-hidden="true" class="contents"><span class="text-git-added">+1,234</span><span class="text-git-removed">−5</span></span></span>',
		);
	});

	it("uses the singular for one and renders zeros", () => {
		expect([
			renderToStaticMarkup(<DiffStat added={1} removed={1} />),
			renderToStaticMarkup(<DiffStat added={0} removed={0} />),
		]).toStrictEqual([
			'<span dir="ltr" class="tabular-nums"><span class="sr-only">1 addition, 1 deletion</span><span aria-hidden="true" class="contents"><span class="text-git-added">+1</span><span class="text-git-removed">−1</span></span></span>',
			'<span dir="ltr" class="tabular-nums"><span class="sr-only">0 additions, 0 deletions</span><span aria-hidden="true" class="contents"><span class="text-git-added">+0</span><span class="text-git-removed">−0</span></span></span>',
		]);
	});
});

describe("git stat colors", () => {
	it("compiles text-git-added / text-git-removed to upstream's cds git tokens", async () => {
		expect(await compileAll(["text-git-added", "text-git-removed"])).toStrictEqual({
			"text-git-added": ".text-git-added { color: var(--upstream-git-added); }",
			"text-git-removed": ".text-git-removed { color: var(--upstream-git-removed); }",
		});
	});

	it("compiles the env-bar stat's text-body-medium to upstream's body size at the control weight", async () => {
		expect(await compileAll(["text-body-medium"])).toStrictEqual({
			"text-body-medium":
				".text-body-medium { font-size: var(--upstream-text-body); line-height: var(--tw-leading, var(--upstream-leading-body)); font-weight: var(--tw-font-weight, var(--font-weight-control)); }",
		});
	});
});

describe("AnimatedDiffStat", () => {
	let frames: FrameQueue;

	beforeEach(() => {
		frames = installFrameQueue();
		stubReducedMotion(false);
	});

	it("tweens the visible digits while the sr line already reads the final counts", () => {
		const {container, rerender} = render(<AnimatedDiffStat added={10} removed={110} />);
		const mount = container.innerHTML;
		rerender(<AnimatedDiffStat added={110} removed={10} />);
		act(() => {
			frames.frame(200);
		});
		const mid = container.innerHTML;
		act(() => {
			frames.frame(400);
		});
		expect({mount, mid, end: container.innerHTML}).toStrictEqual({
			mount: '<span dir="ltr" class="tabular-nums"><span class="sr-only">10 additions, 110 deletions</span><span aria-hidden="true" class="contents"><span class="text-git-added">+10</span><span class="text-git-removed">−110</span></span></span>',
			mid: '<span dir="ltr" class="tabular-nums"><span class="sr-only">110 additions, 10 deletions</span><span aria-hidden="true" class="contents"><span class="text-git-added">+98</span><span class="text-git-removed">−23</span></span></span>',
			end: '<span dir="ltr" class="tabular-nums"><span class="sr-only">110 additions, 10 deletions</span><span aria-hidden="true" class="contents"><span class="text-git-added">+110</span><span class="text-git-removed">−10</span></span></span>',
		});
	});
});
