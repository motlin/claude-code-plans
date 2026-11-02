// @vitest-environment jsdom

import {cleanup, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {DensityOverride, DensityScope} from "../src/components/ui/density";
import {
	FIZZY_LAKE_ATTRIBUTE,
	FIZZY_LAKE_COLOR,
	FIZZY_LAKE_PANELS,
	FIZZY_LAKE_PANELS_FINE_POINTER_QUERY,
	FIZZY_LAKE_PARTS,
	FIZZY_LAKE_TYPE,
	FizzyLakeContext,
	type FizzyLakePart,
	useFizzyLake,
} from "../src/lib/fizzy-lake";

const TYPE_ONLY: readonly FizzyLakePart[] = ["type"];

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

function stubPointer(coarse: boolean) {
	vi.stubGlobal(
		"matchMedia",
		vi.fn((query: string) => ({
			matches: query === "(pointer: coarse)" ? coarse : false,
			media: query,
			onchange: null,
			addEventListener: () => undefined,
			removeEventListener: () => undefined,
			addListener: () => undefined,
			removeListener: () => undefined,
			dispatchEvent: () => false,
		})),
	);
}

function scopeDensity(
	parts: readonly FizzyLakePart[] | undefined,
	inner: "compact" | "comfortable",
	override?: "compact",
) {
	const scope = (
		<DensityScope density={inner}>
			<span data-testid="probe" />
		</DensityScope>
	);
	const withOverride = override === undefined ? scope : <DensityOverride density={override}>{scope}</DensityOverride>;
	render(
		parts === undefined ? (
			withOverride
		) : (
			<FizzyLakeContext.Provider value={parts}>{withOverride}</FizzyLakeContext.Provider>
		),
	);
	return screen.getByTestId("probe").parentElement?.getAttribute("data-density");
}

describe("fizzy-lake switch", () => {
	it("adopts all three upstream parts by default, rendered as upstream's html[data-cds-fizzy-lake]", () => {
		expect({
			parts: FIZZY_LAKE_PARTS,
			attribute: FIZZY_LAKE_ATTRIBUTE,
			color: FIZZY_LAKE_COLOR,
			panels: FIZZY_LAKE_PANELS,
			type: FIZZY_LAKE_TYPE,
			fineQuery: FIZZY_LAKE_PANELS_FINE_POINTER_QUERY,
		}).toStrictEqual({
			parts: ["color", "panels", "type"],
			attribute: "color panels type",
			color: true,
			panels: true,
			type: true,
			fineQuery: "(hover: hover) and (pointer: fine), (hover: hover) and (pointer: none)",
		});
	});

	it("reads one part from the nearest context, defaulting to the switch", () => {
		function Probe() {
			return (
				<span data-testid="parts">{`${useFizzyLake("color")} ${useFizzyLake("panels")} ${useFizzyLake("type")}`}</span>
			);
		}
		render(
			<>
				<Probe />
				<FizzyLakeContext.Provider value={TYPE_ONLY}>
					<Probe />
				</FizzyLakeContext.Provider>
			</>,
		);
		expect(screen.getAllByTestId("parts").map((el) => el.textContent)).toStrictEqual([
			"true true true",
			"false false true",
		]);
	});
});

describe("fizzy-lake panels step in density resolution (upstream si)", () => {
	it("makes a compact scope comfortable on a fine pointer when panels is on, and keeps it compact when off", () => {
		stubPointer(false);
		const on = scopeDensity(["color", "panels", "type"], "compact");
		cleanup();
		const off = scopeDensity(["color", "type"], "compact");
		cleanup();
		const byDefault = scopeDensity(undefined, "compact");
		expect({on, off, byDefault}).toStrictEqual({on: "comfortable", off: "compact", byDefault: "comfortable"});
	});

	it("lets a density override win over panels, as upstream's densityOverride ?? He ?? panels order", () => {
		stubPointer(false);
		expect(scopeDensity(["panels"], "comfortable", "compact")).toBe("compact");
	});

	it("still swaps to comfortable on a coarse pointer with panels off", () => {
		stubPointer(true);
		expect(scopeDensity([], "compact")).toBe("comfortable");
	});
});
