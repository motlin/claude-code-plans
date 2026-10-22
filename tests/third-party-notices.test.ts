import {readFileSync} from "node:fs";
import {join} from "node:path";
import rawIconSet from "../src/lib/file-type-icon-set.json";

const notices = readFileSync(join(import.meta.dirname, "..", "THIRD_PARTY_NOTICES.md"), "utf8");

describe("THIRD_PARTY_NOTICES.md", () => {
	it("attributes the bundled file-type icon set to @pierre/trees under Apache-2.0", () => {
		expect({
			pierreTrees: notices.includes("@pierre/trees"),
			apacheLicense: notices.includes("Apache License"),
			source: notices.includes(rawIconSet.source),
			licenseText: notices.includes(rawIconSet.license.trim()),
			bundledFile: notices.includes("src/lib/file-type-icon-set.json"),
		}).toStrictEqual({
			pierreTrees: true,
			apacheLicense: true,
			source: true,
			licenseText: true,
			bundledFile: true,
		});
	});
});
