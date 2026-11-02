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
	};
}

const SURFACE = "rounded-card bg-page shadow-card-ring text-primary @container";

describe("NoticeBanner density", () => {
	it("takes upstream's panels Banner under comfortable density: !py-lg and the pad-md-6px Dismiss margin", () => {
		expect(metrics((banner): ReactNode => banner)).toStrictEqual({
			root: `flex items-start gap-2 py-4 font-sans text-body font-normal break-words px-4 ${SURFACE}`,
			body: "flex min-w-0 flex-wrap items-start gap-y-3 gap-x-4 flex-1",
			dismissSlot: "-me-1.5 flex h-[1lh] shrink-0 items-center",
		});
	});

	it("keeps the pre-panels compact Banner with panels off", () => {
		expect(metrics((banner) => <CompactScope>{banner}</CompactScope>)).toStrictEqual({
			root: `flex items-start gap-1.5 py-2 font-sans text-body font-normal break-words px-3 ${SURFACE}`,
			body: "flex min-w-0 flex-wrap items-start gap-y-2 gap-x-3 flex-1",
			dismissSlot: "-me-1.5 flex h-[1lh] shrink-0 items-center",
		});
	});

	it("keeps py-md and the pad-md-2px Dismiss margin in a comfortable scope with panels off", () => {
		expect(
			metrics((banner) => (
				<PanelsOff>
					<DensityScope density="comfortable">{banner}</DensityScope>
				</PanelsOff>
			)),
		).toStrictEqual({
			root: `flex items-start gap-2 py-3 font-sans text-body font-normal break-words px-4 ${SURFACE}`,
			body: "flex min-w-0 flex-wrap items-start gap-y-3 gap-x-4 flex-1",
			dismissSlot: "-me-2.5 flex h-[1lh] shrink-0 items-center",
		});
	});

	it("takes panels' py-lg at compact tokens when an override forces compact", () => {
		expect(
			metrics((banner) => (
				<DensityOverride density="compact">
					<DensityScope>{banner}</DensityScope>
				</DensityOverride>
			)),
		).toStrictEqual({
			root: `flex items-start gap-1.5 py-3 font-sans text-body font-normal break-words px-3 ${SURFACE}`,
			body: "flex min-w-0 flex-wrap items-start gap-y-2 gap-x-3 flex-1",
			dismissSlot: "-me-0.5 flex h-[1lh] shrink-0 items-center",
		});
	});
});
