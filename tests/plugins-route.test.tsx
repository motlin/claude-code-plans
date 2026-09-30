import {describe, expect, it, vi} from "vite-plus/test";
import {Route as CustomizePluginsRoute} from "../src/routes/customize.plugins";

describe("blank-screen prevention on /customize/plugins", () => {
	it("the loader warms caches without awaiting them", () => {
		const never = new Promise<never>(() => {});
		const queryClient = {
			prefetchQuery: vi.fn(() => never),
			ensureQueryData: vi.fn(() => never),
		};
		const loader = CustomizePluginsRoute.options.loader as (args: {context: unknown}) => unknown;

		expect({
			result: loader({context: {queryClient}}),
			prefetched: queryClient.prefetchQuery.mock.calls.length,
			awaited: queryClient.ensureQueryData.mock.calls.length,
		}).toStrictEqual({result: undefined, prefetched: 2, awaited: 0});
	});
});
