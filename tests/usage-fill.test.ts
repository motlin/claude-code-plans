import {describe, expect, it} from "vite-plus/test";
import {usageFillClass} from "../src/components/session-rail/usage-fill";

describe("usageFillClass", () =>
{
	it("fills accent, then warning at 75 and danger at 90, as upstream's `G`", () =>
	{
		expect([0, 74, 75, 89, 90, 100].map(usageFillClass)).toStrictEqual([
			"bg-fill-accent",
			"bg-fill-accent",
			"bg-usage-warning forced-colors:bg-[color:Highlight]",
			"bg-usage-warning forced-colors:bg-[color:Highlight]",
			"bg-usage-danger",
			"bg-usage-danger",
		]);
	});
});
