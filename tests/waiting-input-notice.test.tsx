// @vitest-environment jsdom

import {cleanup, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {WaitingForInputNotice, showsWaitingForInputNotice} from "../src/components/approval-card";

afterEach(cleanup);

describe("showsWaitingForInputNotice", () => {
	it("shows only for a waiting session with no question or permission card to dock instead", () => {
		expect([
			showsWaitingForInputNotice({state: "waiting", hasDockedCard: false}),
			showsWaitingForInputNotice({state: "waiting", hasDockedCard: true}),
			showsWaitingForInputNotice({state: "working", hasDockedCard: false}),
			showsWaitingForInputNotice({state: "ended", hasDockedCard: false}),
			showsWaitingForInputNotice({state: null, hasDockedCard: false}),
		]).toStrictEqual([true, false, false, false, false]);
	});
});

describe("WaitingForInputNotice", () => {
	it("announces the wait with the awaiting dot and no controls", () => {
		const {container} = render(<WaitingForInputNotice />);

		const notice = screen.getByRole("status", {name: "Waiting for your input"});
		expect({
			text: notice.textContent,
			dot: container.querySelector(".status-dot")?.getAttribute("data-kind"),
			controls: container.querySelectorAll("button, textarea, input, [tabindex]").length,
		}).toStrictEqual({
			text: "Waiting for your inputAnswer in the terminal running this session.",
			dot: "awaiting",
			controls: 0,
		});
	});
});
