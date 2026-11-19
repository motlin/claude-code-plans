import {bulkArchiveDescription} from "../src/lib/bulk-archive-copy";

describe("bulkArchiveDescription", () =>
{
	it("pluralizes upstream's Tvqpf+ sentence on the count", () =>
	{
		expect([bulkArchiveDescription(1), bulkArchiveDescription(43)]).toStrictEqual([
			"1 session will be archived.",
			"43 sessions will be archived.",
		]);
	});
});
