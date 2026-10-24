// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {SendingUserRow} from "../src/components/pending-user-row";

afterEach(() => {
	cleanup();
});

describe("SendingUserRow", () => {
	it("draws upstream's sending row: dimmed user row, the prompt bubble and a Sending… status", () => {
		const {container} = render(<SendingUserRow prompt="Fix Alice's test" />);
		const row = container.querySelector("[data-delivery-status]");
		const status = container.querySelector("[role=status]");
		expect({
			delivery: row?.getAttribute("data-delivery-status"),
			rowClass: row?.className,
			perfPrompt: container.querySelector("[data-perf-pending-prompt]") !== null,
			bubble: container.querySelector(".user-message-bubble")?.textContent,
			statusLine: status?.parentElement?.className,
			status: status?.textContent,
			statusClass: status?.className,
		}).toStrictEqual({
			delivery: "sending",
			rowClass:
				"group/msg flex w-full justify-end opacity-60 transition-opacity duration-200 ease-[cubic-bezier(.4,0,.2,1)] motion-reduce:transition-none",
			perfPrompt: true,
			bubble: "Fix Alice's test",
			statusLine: "-mt-[8px] flex items-center gap-[3px]",
			status: "Sending…",
			statusClass: "flex items-center gap-[3px] text-[12px] leading-none text-secondary",
		});
	});
});
