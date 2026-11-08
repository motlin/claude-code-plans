// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {Gauge} from "lucide-react";
import type {ReactNode} from "react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {NoticeBanner} from "../src/components/notice-banner";
import {DensityOverride, DensityScope} from "../src/components/ui/density";
import {FizzyLakeContext, type FizzyLakePart} from "../src/lib/fizzy-lake";
import {CompactScope, PanelsOff} from "./fizzy-lake-off";

afterEach(cleanup);

const WITHOUT_COLOR: readonly FizzyLakePart[] = ["panels", "type"];

function metrics(wrap: (banner: ReactNode) => ReactNode, keyline?: "glyph" | "text") {
	const {container} = render(
		wrap(
			<NoticeBanner icon={<Gauge />} onDismiss={() => {}} {...(keyline === undefined ? {} : {keyline})}>
				Notice
			</NoticeBanner>,
		),
	);
	const banner = container.querySelector('[data-cds="Banner"]');
	return {
		keyline: banner?.getAttribute("data-composer-keyline"),
		root: banner?.className,
		iconSlot: banner?.children[0]?.className,
		body: banner?.children[1]?.className,
		dismissSlot: banner?.lastElementChild?.className,
		scope: banner?.closest("[data-density]")?.getAttribute("data-density") ?? null,
	};
}

const LEAD = "flex items-start gap-xs";
const TYPE = "font-sans text-body font-normal break-words px-md rounded-composer";
const FIZZY_SURFACE = "bg-page shadow-card-ring text-primary [--card-ring-color:var(--banner-line)] @container";
const ICON_SLOT = "flex min-h-[1lh] shrink-0 items-center ms-[4px] -me-[4px]";
const BODY = "flex min-w-0 flex-wrap items-start gap-y-sm gap-x-md flex-1";
const GLYPH_BODY = `${BODY} ms-[6px] compact:ms-[6px] comfortable:ms-[4px]`;
const PANELS = {
	keyline: "glyph",
	root: `${LEAD} py-[calc(var(--cds-pad-md)+2px)] ${TYPE} ${FIZZY_SURFACE}`,
	iconSlot: `${ICON_SLOT} text-secondary`,
	body: GLYPH_BODY,
	dismissSlot: "-me-[2px] flex h-[1lh] shrink-0 items-center",
};
const BASE = {
	keyline: "glyph",
	root: `${LEAD} py-md ${TYPE} ${FIZZY_SURFACE}`,
	iconSlot: `${ICON_SLOT} text-secondary`,
	body: GLYPH_BODY,
	dismissSlot: "-me-[4px] flex h-[1lh] shrink-0 items-center",
};

describe("NoticeBanner composer keyline", () => {
	// Upstream's dock cards always pass composerCalibration (`rB()`), so `ah` takes its keyline branch:
	// px-md, rounded-composer, the icon and body offsets and the keyline Dismiss margins.
	it("takes upstream's panels keyline Banner under comfortable density: pad-md+2px block padding and the -2px Dismiss margin", () => {
		expect(metrics((banner): ReactNode => banner)).toStrictEqual({...PANELS, scope: null});
	});

	it("keeps py-md and the glyph -4px Dismiss margin in the compact column with panels off", () => {
		expect(metrics((banner) => <CompactScope>{banner}</CompactScope>)).toStrictEqual({...BASE, scope: "compact"});
	});

	it("keeps py-md and the glyph -4px Dismiss margin in a comfortable scope with panels off", () => {
		expect(
			metrics((banner) => (
				<PanelsOff>
					<DensityScope density="comfortable">{banner}</DensityScope>
				</PanelsOff>
			)),
		).toStrictEqual({...BASE, scope: "comfortable"});
	});

	it("takes the panels block padding at compact tokens when an override forces compact", () => {
		expect(
			metrics((banner) => (
				<DensityOverride density="compact">
					<DensityScope>{banner}</DensityScope>
				</DensityOverride>
			)),
		).toStrictEqual({...PANELS, scope: "compact"});
	});

	it("uses the text keyline's body offset and Dismiss margin for a composer with no leading item", () => {
		expect(metrics((banner) => <CompactScope>{banner}</CompactScope>, "text")).toStrictEqual({
			...BASE,
			keyline: "text",
			body: `${BODY} ms-[4px] compact:ms-[4px] comfortable:ms-[2px]`,
			dismissSlot: "-me-[2px] compact:-me-[2px] comfortable:-me-[4px] flex h-[1lh] shrink-0 items-center",
			scope: "compact",
		});
	});
});

describe("NoticeBanner neutral surface", () => {
	it("layers upstream's alpha-1 neutral tint over surface-1 and leaves the icon untinted with fizzy-lake color off", () => {
		expect(
			metrics((banner) => <FizzyLakeContext.Provider value={WITHOUT_COLOR}>{banner}</FizzyLakeContext.Provider>),
		).toStrictEqual({
			...PANELS,
			root: `${LEAD} py-[calc(var(--cds-pad-md)+2px)] ${TYPE} bg-surface-1 bg-[linear-gradient(var(--color-alpha-1)_0_0)] shadow-card-ring text-primary @container`,
			iconSlot: ICON_SLOT,
			scope: null,
		});
	});

	it("passes a test id through to the Banner root", () => {
		const {container} = render(
			<NoticeBanner icon={null} data-testid="usage-limit-reached-card">
				Notice
			</NoticeBanner>,
		);
		expect(container.querySelector('[data-cds="Banner"]')?.getAttribute("data-testid")).toBe(
			"usage-limit-reached-card",
		);
	});
});
