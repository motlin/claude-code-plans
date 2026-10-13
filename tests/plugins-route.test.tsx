import {describe, expect, it, vi} from "vite-plus/test";
import {Route as CustomizePluginsRoute} from "../src/routes/customize.plugins";

describe("blank-screen prevention on /customize/plugins", () => {
	it("the loader warms caches without awaiting them", () => {
		const never = new Promise<never>(() => {});
		const queryClient = {
			query: vi.fn(async (_options: {staleTime?: unknown}) => never),
		};
		const loader = CustomizePluginsRoute.options.loader as (args: {context: unknown}) => unknown;

		expect({
			result: loader({context: {queryClient}}),
			queried: queryClient.query.mock.calls.length,
			ensured: queryClient.query.mock.calls.filter(([options]) => options.staleTime === "static").length,
		}).toStrictEqual({result: undefined, queried: 2, ensured: 0});
	});
});
