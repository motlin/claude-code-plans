import {renderToStaticMarkup} from "react-dom/server";
import {describe, expect, it, vi} from "vite-plus/test";
import {Route as SetupRoute} from "../src/routes/setup";

vi.mock("../src/components/hook-setup", () => ({
	HookSetup: () => <div>hook setup</div>,
}));

describe("/setup page", () => {
	it("titles the page with upstream's 24/32 serif PageHeader over its description", () => {
		const Component = SetupRoute.options.component!;
		expect(renderToStaticMarkup(<Component />)).toBe(
			'<div class="max-w-3xl"><header class="flex flex-col pb-4 sm:-mt-1"><h1 class="min-w-0 font-voice text-[24px]/[32px] font-medium text-primary">Setup</h1><p class="mt-1 text-[13px] text-t6">Configure Claude Code to send hook events to this server for live updates.</p></header><div class="mt-2"><div>hook setup</div></div></div>',
		);
	});
});
