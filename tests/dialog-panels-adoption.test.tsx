// @vitest-environment jsdom

import {cleanup, render, screen} from "@testing-library/react";
import type {ReactNode} from "react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {ConfirmDialog} from "../src/components/confirm-dialog";
import {NewGroupDialog} from "../src/components/new-group-dialog";
import {RewindConfirm} from "../src/components/rewind-confirm";
import {RewindPicker} from "../src/components/rewind-picker";
import {SessionRenameDialog} from "../src/components/session-rename-dialog";
import {TextPreviewDialog} from "../src/components/text-preview-dialog";
import {DIALOG_BAND_BODY_CLASS} from "../src/components/ui/dialog-band";
import {DIALOG_BODY_CLASS} from "../src/components/ui/dialog-classes";
import {PanelsOff} from "./fizzy-lake-off";
import {mockTallWindow} from "./tall-window";

let restore: (() => void) | undefined;
afterEach(() => {
	restore?.();
	restore = undefined;
});

function noop() {}

const pick = (element: Element | null | undefined, names: string[]) =>
	names.filter((name) => (element?.className.split(" ") ?? []).includes(name));

const DIALOGS: Record<string, {node: () => ReactNode; body: (popup: HTMLElement) => Element | null}> = {
	"New section": {
		node: () => <NewGroupDialog open onOpenChange={noop} onCreate={noop} />,
		body: (popup) => popup.querySelector("form"),
	},
	Rename: {
		node: () => <SessionRenameDialog open initialName="a" onClose={noop} onRename={noop} />,
		body: (popup) => popup.querySelector("form"),
	},
	"Text preview": {
		node: () => <TextPreviewDialog open title="t" text="x" variant="excerpt" onClose={noop} />,
		body: (popup) => popup.firstElementChild,
	},
	"Rewind confirm": {
		node: () => <RewindConfirm text="hi" preview="none" conversation onClose={noop} onConfirm={async () => {}} />,
		body: (popup) => popup.firstElementChild,
	},
	"Rewind picker": {
		node: () => <RewindPicker open turns={[{uuid: "u1", text: "a"}]} onClose={noop} onSelect={noop} />,
		body: (popup) => popup.firstElementChild,
	},
};

async function popupOf(node: ReactNode) {
	render(node);
	return screen.findByRole("dialog");
}

describe("dialog bodies carry upstream's Xn scroll-fade-y (menu-scroll-fade-utility)", () => {
	for (const name of ["Text preview", "Rewind confirm", "Rewind picker"]) {
		it(`${name}: the body is upstream's Xn, scroll-fade-y included`, async () => {
			const popup = await popupOf(DIALOGS[name]?.node());
			const body = DIALOGS[name]?.body(popup);
			const xn = DIALOG_BODY_CLASS.split(" ");
			expect(pick(body, xn)).toStrictEqual(xn);
		});
	}
});

describe("dialog popups and pads under panels (dialog-panels-pad-lg)", () => {
	for (const [name, {node, body}] of Object.entries(DIALOGS)) {
		it(`${name}: data-cds markers and a 16px body; 24px (20px picker) with panels off`, async () => {
			restore = mockTallWindow(true).restore;
			const on = await popupOf(node());
			const onResult = {
				cds: on.getAttribute("data-cds"),
				fizzy: on.getAttribute("data-cds-fizzy"),
				tall: on.getAttribute("data-cds-tall-window"),
				pad: pick(body(on), ["p-4", "p-5", "p-6"]),
				popupPad: pick(on, ["p-4", "p-5", "p-6"]),
			};
			cleanup();
			const off = await popupOf(<PanelsOff>{node()}</PanelsOff>);
			expect({
				on: onResult,
				off: {
					cds: off.getAttribute("data-cds"),
					fizzy: off.getAttribute("data-cds-fizzy"),
					pad: pick(body(off), ["p-4", "p-5", "p-6"]),
				},
			}).toStrictEqual({
				on: {cds: "Dialog", fizzy: "", tall: "", pad: ["p-4"], popupPad: []},
				off: {cds: "Dialog", fizzy: null, pad: [name === "Rewind picker" ? "p-5" : "p-6"]},
			});
		});
	}

	it("Rewind picker: the 16px list bleed and last-row scroll margin; 20px with panels off", async () => {
		const read = () => ({
			list: pick(screen.getByRole("listbox"), [
				"-mx-4",
				"-mb-4",
				"px-4",
				"pb-4",
				"max-h-[calc(50vh+16px)]",
				"-mx-5",
				"-mb-5",
				"px-5",
				"pb-5",
				"max-h-[calc(50vh+20px)]",
			]),
			option: pick(screen.getByRole("option"), ["last:scroll-mb-4", "last:scroll-mb-5"]),
		});
		await popupOf(DIALOGS["Rewind picker"]?.node());
		const on = read();
		cleanup();
		await popupOf(<PanelsOff>{DIALOGS["Rewind picker"]?.node()}</PanelsOff>);
		expect({on, off: read()}).toStrictEqual({
			on: {list: ["-mx-4", "-mb-4", "px-4", "pb-4", "max-h-[calc(50vh+16px)]"], option: ["last:scroll-mb-4"]},
			off: {list: ["-mx-5", "-mb-5", "px-5", "pb-5", "max-h-[calc(50vh+20px)]"], option: ["last:scroll-mb-5"]},
		});
	});

	it("puts every footer 16px below the body at either flag state (upstream RQ mt-pad-lg)", async () => {
		const footers: Record<string, string[]> = {};
		const footerOf = (label: string) => screen.getByRole("button", {name: label}).parentElement;
		const cases: [string, () => ReactNode, string][] = [
			["New section", DIALOGS["New section"]!.node, "Create section"],
			["Rename", DIALOGS["Rename"]!.node, "Save"],
			["Rewind confirm", DIALOGS["Rewind confirm"]!.node, "Rewind"],
			[
				"Confirm",
				() => <ConfirmDialog open onOpenChange={noop} title="t" confirmLabel="Go" onConfirm={noop} />,
				"Go",
			],
		];
		for (const [name, node, label] of cases) {
			render(node());
			await screen.findByRole("button", {name: label});
			footers[name] = pick(footerOf(label), ["mt-4", "mt-6"]);
			cleanup();
			render(<PanelsOff>{node()}</PanelsOff>);
			await screen.findByRole("button", {name: label});
			footers[`${name} off`] = pick(footerOf(label), ["mt-4", "mt-6"]);
			cleanup();
		}
		expect(footers).toStrictEqual({
			"New section": ["mt-4"],
			"New section off": ["mt-4"],
			Rename: ["mt-4"],
			"Rename off": ["mt-4"],
			"Rewind confirm": ["mt-4"],
			"Rewind confirm off": ["mt-4"],
			Confirm: ["mt-4"],
			"Confirm off": ["mt-4"],
		});
	});
});

function bandSummary(popup: HTMLElement) {
	const heading = popup.querySelector("h2");
	const band = heading?.parentElement;
	return {
		part: band?.getAttribute("data-cds-part") ?? null,
		children: [...(band?.children ?? [])].map((child) => child.tagName),
		title: heading?.textContent,
		close: screen.queryByRole("button", {name: "Close"})?.parentElement === band ? "band" : null,
		next: band?.nextElementSibling?.tagName,
		nextClass: band?.nextElementSibling?.className,
	};
}

describe("dialog header band under panels (dialog-header-panels-band)", () => {
	it("Rename and New section: a title-only band in a band body; flag-off keeps today's title", async () => {
		const rename = await popupOf(DIALOGS["Rename"]?.node());
		const renameOn = {
			band: bandSummary(rename).part,
			children: bandSummary(rename).children,
			title: bandSummary(rename).title,
			body: rename.querySelector("form")?.className.includes(DIALOG_BAND_BODY_CLASS),
		};
		cleanup();
		const group = await popupOf(DIALOGS["New section"]?.node());
		const groupOn = {
			band: bandSummary(group).part,
			children: bandSummary(group).children,
			title: bandSummary(group).title,
		};
		cleanup();
		const renameOff = await popupOf(<PanelsOff>{DIALOGS["Rename"]?.node()}</PanelsOff>);
		const heading = renameOff.querySelector("h2");
		expect({
			renameOn,
			groupOn,
			off: {band: bandSummary(renameOff).part, title: heading?.textContent, classes: heading?.className},
		}).toStrictEqual({
			renameOn: {band: "band", children: ["H2"], title: "Rename", body: true},
			groupOn: {band: "band", children: ["H2"], title: "New section"},
			off: {
				band: null,
				title: "Rename session",
				classes: "text-[17px] leading-6 font-semibold break-words text-primary",
			},
		});
	});

	it("Rewind picker: band Rewind + Close, the description, then the listbox", async () => {
		const popup = await popupOf(DIALOGS["Rewind picker"]?.node());
		const summary = bandSummary(popup);
		const description = popup.querySelector("[data-cds-part=band] + p");
		expect({
			...summary,
			afterDescription: description?.nextElementSibling?.getAttribute("role"),
			body: popup.firstElementChild?.className.includes(DIALOG_BAND_BODY_CLASS),
		}).toStrictEqual({
			part: "band",
			children: ["H2", "BUTTON"],
			title: "Rewind",
			close: "band",
			next: "P",
			nextClass: "text-body font-normal text-secondary break-words mb-4",
			afterDescription: "listbox",
			body: true,
		});
	});

	it("Rewind confirm: a padded inner scroller, a title-only band, then the body with no top margin", async () => {
		const popup = await popupOf(DIALOGS["Rewind confirm"]?.node());
		const scroller = popup.firstElementChild;
		expect({
			scroller: pick(scroller, ["isolate", "flex", "min-h-0", "flex-1", "flex-col", "overflow-y-auto", "p-4"]),
			...bandSummary(popup),
		}).toStrictEqual({
			scroller: ["isolate", "flex", "min-h-0", "flex-1", "flex-col", "overflow-y-auto", "p-4"],
			part: "band",
			children: ["H2"],
			title: "Rewind to this message?",
			close: null,
			next: "DIV",
			nextClass: "flex flex-col gap-3",
		});
	});

	it("Rewind confirm with panels off keeps the 17/24 title and the body's mt-3", async () => {
		const popup = await popupOf(<PanelsOff>{DIALOGS["Rewind confirm"]?.node()}</PanelsOff>);
		const heading = popup.querySelector("h2");
		expect({
			band: popup.querySelector("[data-cds-part=band]"),
			title: heading?.className,
			body: heading?.parentElement?.parentElement?.nextElementSibling?.className,
		}).toStrictEqual({
			band: null,
			title: "text-[17px] leading-6 font-semibold break-words text-primary",
			body: "mt-3 flex flex-col gap-3",
		});
	});

	it("Text preview: band title + Close with the metadata line as the description", async () => {
		const popup = await popupOf(
			<TextPreviewDialog open title="a.ts" text={"one\ntwo"} variant="file" onClose={noop} />,
		);
		const summary = bandSummary(popup);
		const description = popup.querySelector("[data-cds-part=band] + p");
		expect({
			...summary,
			nextClass: undefined,
			title: popup.querySelector("h2")?.className,
			description: description?.className,
			line: description?.firstElementChild?.className,
			body: popup.firstElementChild?.className.includes(DIALOG_BAND_BODY_CLASS),
		}).toStrictEqual({
			part: "band",
			children: ["H2", "BUTTON"],
			title: "pointer-events-auto min-w-0 flex-1 last:me-2 text-[15px]/[20px] font-[520] break-words text-primary",
			close: "band",
			next: "P",
			nextClass: undefined,
			description: "text-body font-normal text-secondary break-words mb-4",
			line: "flex flex-wrap items-center gap-x-1.5 gap-y-2 text-xs",
			body: true,
		});
	});
});
