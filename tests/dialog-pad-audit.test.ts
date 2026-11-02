import {readdirSync, readFileSync} from "node:fs";
import path from "node:path";
import {describe, expect, it} from "vite-plus/test";

const SRC = path.join(import.meta.dirname, "../src");

// Unstyled upstream consumers keep their own popup and padding (no `_z`, no `data-cds-fizzy`).
const UNSTYLED = new Set([
	"components/command-palette.tsx",
	"components/recents-switcher.tsx",
	"components/image-viewer.tsx",
	"components/image-preview-modal.tsx",
	"components/settings/settings-dialog.tsx",
]);

function sources():
{
	file: string;
	source: string;
}[]
{
	return readdirSync(
		SRC,
		{
			recursive: true,
			encoding: "utf8",
		},
	)
		.filter((file) => file.endsWith(".tsx"))
		.map((file) => file.split(path.sep).join("/"))
		.filter((file) => !UNSTYLED.has(file))
		.toSorted()
		.map((file) => (
		{
			file,
			source: readFileSync(path.join(SRC, file), "utf8"),
		}));
}

/*
 * Upstream applies `_z` and `data-cds-fizzy` in the cds Dialog primitive itself; local has no primitive,
 * so styled dialogs render their popup through DialogPopup and take their pads from useDialogPad.
 * ConfirmDialog is an AlertDialog with its own panels body (panels-flag-flat-look T2).
 */
describe("styled dialog popups", () =>
{
	it("render Dialog.Popup only through DialogPopup", () =>
	{
		expect(
			sources()
				.filter(
					({file, source}) => file !== "components/ui/dialog-popup.tsx" && source.includes("<Dialog.Popup"),
				)
				.map(({file}) => file),
		).toStrictEqual([]);
	});

	it("hard-code no 20/24px body pad", () =>
	{
		expect(
			sources()
				.filter(({source}) => source.includes("<DialogPopup"))
				.filter(({source}) =>
					source.split("\n").some((line) => /\bp-[56]\b/.test(line) && line.includes("flex-col")),
				)
				.map(({file}) => file),
		).toStrictEqual([]);
	});
});
