import {afterEach, describe, expect, it} from "vite-plus/test";

import {readSidebarMenuMode, setSidebarMenuOpen, subscribeSidebarMenuOpen} from "../src/lib/sidebar-menu-open";

afterEach(() =>
{
	setSidebarMenuOpen(false);
});

describe("sidebar menu-open store (upstream overflowMenuOpen/sortMenuOpen)", () =>
{
	it("is sort only for a Group and sort menu opened first, and notifies only on a change", () =>
	{
		let notified = 0;
		const unsubscribe = subscribeSidebarMenuOpen(() =>
		{
			notified++;
		});
		const modes: string[] = [];
		setSidebarMenuOpen(true, true);
		modes.push(readSidebarMenuMode());
		setSidebarMenuOpen(true, true);
		setSidebarMenuOpen(false);
		modes.push(readSidebarMenuMode());
		setSidebarMenuOpen(false);
		setSidebarMenuOpen(true);
		modes.push(readSidebarMenuMode());
		setSidebarMenuOpen(true, true);
		modes.push(readSidebarMenuMode());
		unsubscribe();
		expect(
			{
				modes,
				notified,
			},
		).toStrictEqual(
			{
				modes: ["sort", "none", "menu", "menu"],
				notified: 3,
			},
		);
	});
});
