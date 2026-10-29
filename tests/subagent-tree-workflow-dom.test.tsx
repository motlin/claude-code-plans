// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {SubagentTreeEntries} from "../src/components/subagent-tree";
import {buildSubagentTree} from "../src/lib/subagent-tree";
import type {Subagent} from "../src/lib/subagents";

function workflowAgent(id: string, description: string, finishedAt: string | null): Subagent {
	return {
		id,
		sessionId: "session-test",
		projectId: "project-test",
		parentAgentId: null,
		agentType: "workflow-subagent",
		attributionAgent: null,
		slug: null,
		description,
		model: null,
		startedAt: "1999-12-31T00:00:00.000Z",
		finishedAt,
		workflowRunId: "wf_a",
		workflowPhase: "Draft",
		workflowPhaseIndex: 1,
	};
}

const presentation = {indexedAgentIds: new Set<string>(), liveStatuses: new Map<string, "running" | "ended">()};

afterEach(cleanup);

describe("SubagentTreeEntries workflow runs", () => {
	it("shows a running run's phase open and collapsing it hides its agent rows", () => {
		const entries = buildSubagentTree([workflowAgent("agent-a1", "poem-1", null)], {
			workflowRuns: [{runId: "wf_a", workflowName: "poems", status: "running"}],
		});
		render(<SubagentTreeEntries entries={entries} presentation={presentation} />);

		expect(screen.getByText("poems").textContent).toBe("poems");
		const phase = screen.getByRole("button", {name: "Phase: Draft, Running, 0 of 1 agent done"});
		expect(phase.getAttribute("aria-expanded")).toBe("true");
		expect(phase.textContent).toBe("Draft0/1");
		expect(screen.queryByText("poem-1")?.textContent).toBe("poem-1");

		fireEvent.click(phase);

		expect(phase.getAttribute("aria-expanded")).toBe("false");
		expect(screen.queryByText("poem-1")).toBeNull();
	});

	it("starts a finished run's phases collapsed", () => {
		const entries = buildSubagentTree([workflowAgent("agent-a1", "poem-1", "1999-12-31T00:00:05.000Z")], {
			workflowRuns: [{runId: "wf_a", workflowName: "poems", status: "completed"}],
		});
		render(<SubagentTreeEntries entries={entries} presentation={presentation} />);

		const phase = screen.getByRole("button", {name: "Phase: Draft, Done, 1 of 1 agent done"});
		expect(phase.getAttribute("aria-expanded")).toBe("false");
		expect(screen.queryByText("poem-1")).toBeNull();
	});

	it('tucks superseded attempts under a collapsed "Earlier attempts (N)" disclosure and tags failed agents', () => {
		const entries = buildSubagentTree(
			[
				{
					...workflowAgent("agent-a1", "poem-1", "1999-12-31T00:00:05.000Z"),
					workflowState: "failed",
					workflowAttempt: "final",
				},
				{
					...workflowAgent("agent-a0", "poem-1-first-try", null),
					workflowState: "ended",
					workflowAttempt: "superseded",
				},
			],
			{workflowRuns: [{runId: "wf_a", workflowName: "poems", status: "running"}]},
		);
		render(<SubagentTreeEntries entries={entries} presentation={presentation} />);

		const failed = screen.getByText("Failed");
		expect({text: failed.textContent, danger: failed.classList.contains("text-danger")}).toStrictEqual({
			text: "Failed",
			danger: true,
		});
		const earlier = screen.getByRole("button", {name: "Earlier attempts (1)"});
		expect(earlier.getAttribute("aria-expanded")).toBe("false");
		expect(screen.queryByText("poem-1-first-try")).toBeNull();

		fireEvent.click(earlier);

		expect(earlier.getAttribute("aria-expanded")).toBe("true");
		expect(screen.getByText("poem-1-first-try").textContent).toBe("poem-1-first-try");
	});
});
