// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {RunningTasksControl} from "../src/components/running-tasks-control";

afterEach(cleanup);

function control(count: number) {
	const {container} = render(<RunningTasksControl count={count} />);
	const button = container.querySelector("button");
	return button === null
		? null
		: {
				text: button.textContent,
				wrapper: button.parentElement?.className,
				button: button.className,
				column: button.parentElement?.parentElement?.className,
			};
}

describe("RunningTasksControl", () => {
	it("draws upstream's muted 'N running tasks' status control at the transcript's text inset, and nothing with none running", () => {
		const shape = {
			wrapper: "epitaxy-status-control inline-flex items-center",
			button: "inline-flex h-5 items-center gap-1 rounded-r4 px-1.5 text-body text-ink-muted",
			column: "chat-column pb-8",
		};

		expect({two: control(2), one: control(1), none: control(0)}).toStrictEqual({
			two: {text: "2 running tasks", ...shape},
			one: {text: "1 running task", ...shape},
			none: null,
		});
	});
});
