import {readFileSync} from "node:fs";
import {join} from "node:path";
import rawIconSet from "../src/lib/file-type-icon-set.json";
import catppuccinIconSet from "../src/lib/file-type-icon-sets/catppuccin.json";
import vscodeIconSet from "../src/lib/file-type-icon-sets/vscode.json";

const notices = readFileSync(join(import.meta.dirname, "..", "THIRD_PARTY_NOTICES.md"), "utf8");

describe("THIRD_PARTY_NOTICES.md", () =>
{
	it("attributes the bundled file-type icon set to @pierre/trees under Apache-2.0", () =>
	{
		expect(
			{
				pierreTrees: notices.includes("@pierre/trees"),
				apacheLicense: notices.includes("Apache License"),
				source: notices.includes(rawIconSet.source),
				licenseText: notices.includes(rawIconSet.license.trim()),
				bundledFile: notices.includes("src/lib/file-type-icon-set.json"),
			},
		).toStrictEqual(
			{
				pierreTrees: true,
				apacheLicense: true,
				source: true,
				licenseText: true,
				bundledFile: true,
			},
		);
	});

	it.each([
		["Catppuccin", "src/lib/file-type-icon-sets/catppuccin.json", catppuccinIconSet],
		["Seti UI", "src/lib/file-type-icon-sets/vscode.json", vscodeIconSet],
	] as const)("attributes the bundled %s file-type icon set under MIT", (name, file, set) =>
	{
		expect(
			{
				name: notices.includes(name),
				mitLicense: notices.includes("Permission is hereby granted, free of charge"),
				source: notices.includes(set.source),
				licenseText: notices.includes(set.license.trim()),
				bundledFile: notices.includes(file),
			},
		).toStrictEqual(
			{
				name: true,
				mitLicense: true,
				source: true,
				licenseText: true,
				bundledFile: true,
			},
		);
	});
});
