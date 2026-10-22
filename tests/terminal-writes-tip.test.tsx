// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {ReadOnlyAnswerHint, TerminalWritesTipProvider} from "../src/components/terminal-writes-tip";
import {actAndSettle} from "./act-and-settle";

afterEach(cleanup);

describe("ReadOnlyAnswerHint", () => {
	it("shows only the terminal hint without a provider", () => {
		const {container} = render(<ReadOnlyAnswerHint className="hint" />);

		expect({text: container.textContent, buttons: screen.queryAllByRole("button").length}).toStrictEqual({
			text: "Answer in the terminal",
			buttons: 0,
		});
	});

	it("offers to turn on terminal writes when the provider can enable them", async () => {
		const enableWrites = vi.fn<() => Promise<void>>(async () => {});
		const {container} = render(
			<TerminalWritesTipProvider enableWrites={enableWrites}>
				<ReadOnlyAnswerHint className="hint" />
			</TerminalWritesTipProvider>,
		);

		expect(container.textContent).toBe("Answer in the terminal · Turn on terminal writes");
		await actAndSettle(() => {
			fireEvent.click(screen.getByRole("button", {name: "Turn on terminal writes"}));
		});
		expect(enableWrites).toHaveBeenCalledTimes(1);
	});
});
