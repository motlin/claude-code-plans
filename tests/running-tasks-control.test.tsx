// @vitest-environment jsdom

import {cleanup, fireEvent, render} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {RunningTasksControl} from "../src/components/running-tasks-control";
import {PaneHostContext, type PaneHostApi} from "../src/components/panes/pane-host-context";

afterEach(cleanup);

function renderInHost(host: PaneHostApi, count: number) {
	return render(
		<PaneHostContext.Provider value={host}>
			<RunningTasksControl count={count} />
		</PaneHostContext.Provider>,
	);
}

function control(count: number) {
	const {container} = render(<RunningTasksControl count={count} />);
	const button = container.querySelector("button");
	return button === null
		? null
		: {text: button.textContent, wrapper: button.parentElement?.className, button: button.className};
}

describe("RunningTasksControl", () => {
	it("draws upstream's muted 'N running tasks' ghost button, and nothing with none running", () => {
		const shape = {
			wrapper: "epitaxy-status-control inline-flex items-center",
			button: "inline-flex h-5 items-center gap-1 rounded-r4 px-1.5 text-body text-ink-muted",
		};

		expect({two: control(2), one: control(1), none: control(0)}).toStrictEqual({
			two: {text: "2 running tasks", ...shape},
			one: {text: "1 running task", ...shape},
			none: null,
		});
	});

	it("opens the Background tasks pane", () => {
		const openPane = vi.fn<PaneHostApi["openPane"]>();
		const {getByRole} = renderInHost({openPane} as unknown as PaneHostApi, 3);
		fireEvent.click(getByRole("button", {name: "3 running tasks"}));
		expect(openPane.mock.calls).toStrictEqual([["background-tasks"]]);
	});
});
