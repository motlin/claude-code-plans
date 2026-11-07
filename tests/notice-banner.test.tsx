// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {Gauge} from "lucide-react";
import type {ReactNode} from "react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {NoticeBanner} from "../src/components/notice-banner";
import {DensityOverride, DensityScope} from "../src/components/ui/density";
import {CompactScope, PanelsOff} from "./fizzy-lake-off";

afterEach(cleanup);

function metrics(wrap: (banner: ReactNode) => ReactNode) {
	const {container} = render(
		wrap(
			<NoticeBanner icon={<Gauge />} onDismiss={() => {}}>
				Notice
			</NoticeBanner>,
		),
	);
	const banner = container.querySelector('[data-cds="Banner"]');
	return {
		root: banner?.className,
		body: banner?.children[1]?.className,
		dismissSlot: banner?.lastElementChild?.className,
		scope: banner?.closest("[data-density]")?.getAttribute("data-density") ?? null,
	};
}

const SURFACE = "rounded-card bg-page shadow-card-ring text-primary @container";
const BODY = "flex min-w-0 flex-wrap items-start gap-y-sm gap-x-md flex-1";
const PANELS = {
	root: `flex items-start gap-xs px-lg !py-lg font-sans text-body font-normal break-words ${SURFACE}`,
	body: BODY,
	dismissSlot: "-me-[calc(var(--cds-pad-md)-6px)] flex h-[1lh] shrink-0 items-center",
};
const BASE = {
	root: `flex items-start gap-xs px-lg py-md font-sans text-body font-normal break-words ${SURFACE}`,
	body: BODY,
	dismissSlot: "-me-[calc(var(--cds-pad-md)-2px)] flex h-[1lh] shrink-0 items-center",
};

describe("NoticeBanner density", () => {
	// The classes are upstream's verbatim cds spacing; the nearest data-density scope picks their values.
	it("takes upstream's panels Banner under comfortable density: !py-lg and the pad-md-6px Dismiss margin", () => {
		expect(metrics((banner): ReactNode => banner)).toStrictEqual({...PANELS, scope: null});
	});

	it("keeps the pre-panels compact Banner with panels off", () => {
		expect(metrics((banner) => <CompactScope>{banner}</CompactScope>)).toStrictEqual({...BASE, scope: "compact"});
	});

	it("keeps py-md and the pad-md-2px Dismiss margin in a comfortable scope with panels off", () => {
		expect(
			metrics((banner) => (
				<PanelsOff>
					<DensityScope density="comfortable">{banner}</DensityScope>
				</PanelsOff>
			)),
		).toStrictEqual({...BASE, scope: "comfortable"});
	});

	it("takes panels' py-lg at compact tokens when an override forces compact", () => {
		expect(
			metrics((banner) => (
				<DensityOverride density="compact">
					<DensityScope>{banner}</DensityScope>
				</DensityOverride>
			)),
		).toStrictEqual({...PANELS, scope: "compact"});
	});
});
