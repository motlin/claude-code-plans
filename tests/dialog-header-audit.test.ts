import {readdirSync, readFileSync} from "node:fs";
import path from "node:path";
import {describe, expect, it} from "vite-plus/test";

const SRC = path.join(import.meta.dirname, "../src");

// Unstyled upstream consumers (no cds Dialog.Header), plus ConfirmDialog's alert band (panels-flag-flat-look T2).
const EXEMPT = new Set([
	"components/command-palette.tsx",
	"components/recents-switcher.tsx",
	"components/image-viewer.tsx",
	"components/image-preview-modal.tsx",
	"components/settings/settings-dialog.tsx",
	"components/confirm-dialog.tsx",
	"components/ui/dialog-header.tsx",
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
		.filter((file) => !EXEMPT.has(file))
		.toSorted()
		.map((file) => (
		{
			file,
			source: readFileSync(path.join(SRC, file), "utf8"),
		}));
}

/*
 * Upstream renders the band inside cds `Dialog.Header` (`JH` → `aj` when `qF`); local has no primitive,
 * so this keeps every styled dialog on the shared header.
 */
describe("styled dialog titles", () =>
{
	it("go through DialogHeader", () =>
	{
		expect(
			sources()
				.filter(({source}) => source.includes("<Dialog.Title"))
				.map(({file}) => file),
		).toStrictEqual([]);
	});
});
