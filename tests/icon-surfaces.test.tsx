// @vitest-environment jsdom

import {globSync, readFileSync} from "node:fs";
import {cleanup, render, screen} from "@testing-library/react";
import {createRef} from "react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {FindBar} from "../src/components/files/find-in-file";
import {SearchRowContents} from "../src/components/sidebar/sidebar-search-field";
import {DensityProvider} from "../src/components/ui/density";

afterEach(cleanup);

function glyph(svg: SVGElement | null | undefined) {
	return {
		cds: svg?.getAttribute("data-cds"),
		stroke: svg?.getAttribute("stroke-width"),
		fontSize: svg?.style.fontSize,
	};
}

const SM = {cds: "Icon", stroke: "1.875", fontSize: "calc(1rem * var(--cds-rem-scale, 1))"};
const MD = {cds: "Icon", stroke: "1.5", fontSize: "calc(1.25rem * var(--cds-rem-scale, 1))"};

describe("surfaces drawn with the cds Icon", () => {
	it("draws the find bar's CaretUp, CaretDown and X at sm (16px, 1.25px stroke)", () => {
		render(
			<FindBar
				inputRef={createRef<HTMLInputElement>()}
				query="alice"
				active={0}
				total={2}
				onQueryChange={() => {}}
				onStep={() => {}}
				onClose={() => {}}
			/>,
		);
		expect(
			["Previous match", "Next match", "Close find bar"].map((name) =>
				glyph(screen.getByRole("button", {name}).querySelector("svg")),
			),
		).toStrictEqual([SM, SM, SM]);
	});

	it("draws the sidebar Search row's glyph at the comfortable sidebar's auto size (20px)", () => {
		const {container} = render(
			<DensityProvider density="comfortable">
				<SearchRowContents keys="mod+k" />
			</DensityProvider>,
		);
		expect(glyph(container.querySelector(".df-leading-slot svg"))).toStrictEqual(MD);
	});

	it("never draws a vertical ellipsis: upstream aliases DotsVertical to DotsHorizontal", () => {
		const offenders = globSync("src/**/*.{ts,tsx}").filter((path) =>
			readFileSync(path, "utf8").includes("EllipsisVertical"),
		);
		expect(offenders).toStrictEqual([]);
	});
});
