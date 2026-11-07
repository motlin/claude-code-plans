// @vitest-environment jsdom

import {cleanup, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {ConfirmDialog} from "../src/components/confirm-dialog";
import {PanelsOff} from "./fizzy-lake-off";

afterEach(cleanup);

function dialog() {
	return (
		<ConfirmDialog
			open
			onOpenChange={() => {}}
			title="Delete session?"
			body="This can't be undone."
			confirmLabel="Delete"
			onConfirm={() => {}}
		/>
	);
}

async function anatomy() {
	const popup = await screen.findByRole("alertdialog");
	const title = screen.getByText("Delete session?");
	const description = screen.getByText("This can't be undone.");
	const band = title.parentElement;
	return {
		cds: popup.getAttribute("data-cds"),
		fizzy: popup.getAttribute("data-cds-fizzy"),
		popupPad: popup.className.split(" ").filter((name) => /^p-\d$/.test(name)),
		body: title.parentElement === popup ? "popup" : (popup.firstElementChild?.className ?? null),
		band:
			band?.getAttribute("data-cds-part") === "band"
				? {alert: band.getAttribute("data-cds-alert"), className: band.className}
				: null,
		title: title.className,
		description: description.className,
	};
}

describe("ConfirmDialog", () => {
	it("renders upstream's panels ConfirmationDialog: a 16px body and the alert band title row (shared-frame jl/nf/jS/_z)", async () => {
		render(dialog());
		expect(await anatomy()).toStrictEqual({
			cds: "ConfirmationDialog",
			fizzy: "",
			popupPad: [],
			body: "isolate flex min-h-0 flex-1 flex-col overflow-y-auto rounded-[inherit] p-4 break-words m-[var(--ring-inner)]",
			band: {
				alert: "",
				className:
					"-mx-4 first:-mt-4 mb-1 flex shrink-0 items-center gap-1 self-stretch justify-self-stretch min-h-12 panels-fine:min-h-11 ps-4 pe-2 py-2 pointer-events-none",
			},
			title: "pointer-events-auto min-w-0 flex-1 last:me-2 text-[15px]/[21px] font-semibold break-words text-primary py-[5.5px] panels-fine:py-[3.5px]",
			description: "text-body font-normal text-secondary break-words -mt-[13.5px] panels-fine:-mt-[11.5px]",
		});
	});

	it("keeps the pre-rollout layout without panels: a 24px popup pad, a plain 17/24 title and no band", async () => {
		render(<PanelsOff>{dialog()}</PanelsOff>);
		expect(await anatomy()).toStrictEqual({
			cds: "ConfirmationDialog",
			fizzy: null,
			popupPad: ["p-6"],
			body: "popup",
			band: null,
			title: "text-[17px] leading-6 font-semibold break-words text-primary",
			description: "mt-2 text-body break-words text-secondary",
		});
	});
});
