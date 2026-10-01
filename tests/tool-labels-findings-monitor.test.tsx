// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {getToolRenderer} from "../src/components/tool-renderers";
import {FallbackRenderer} from "../src/components/tool-renderers/fallback-renderer";
import {ReportFindingsRenderer} from "../src/components/tool-renderers/report-findings-renderer";
import type {ClientToolCall} from "../src/components/tool-renderers/types";
import {toolInputSchemas} from "../src/lib/tool-input-schemas";
import {toolLabel} from "../src/lib/tool-labels";

afterEach(cleanup);

function makeCall(name: string, input: Record<string, unknown>, extra: Partial<ClientToolCall> = {}) {
	const call: ClientToolCall = {id: `tool-${name}`, name, param: "", sourceUuid: "uuid-1", input};
	return {...call, ...extra};
}

const CONFIRMED_FINDING = {
	file: "src/example.ts",
	line: 100,
	category: "correctness",
	short_summary: "Example value is dropped",
	summary: "The example branch drops a requested value.",
	failure_scenario: "Alice requests the example value and receives no result.",
	verdict: "CONFIRMED",
};

const PLAIN_FINDING = {
	file: "src/other.ts",
	line: 7,
	summary: "The other branch reads a stale cache.",
	failure_scenario: "Bob edits the file and sees the old contents.",
};

const MONITOR_INPUT = {
	command: "until curl -s localhost:3000; do sleep 1; done",
	description: "wait for dev server",
	timeout_ms: 60000,
	persistent: false,
};

describe("ReportFindings, Monitor and TaskOutput labels", () => {
	it("labels each row with the upstream verb and failed form", () => {
		const labels = (name: string, input: Record<string, unknown>) => {
			const {verb, failedVerb} = toolLabel({name, input});
			return {verb, failedVerb};
		};

		expect({
			reportFindings: labels("ReportFindings", {findings: [CONFIRMED_FINDING]}),
			monitor: labels("Monitor", MONITOR_INPUT),
			taskOutput: labels("TaskOutput", {task_id: "b1", block: true, timeout: 5000}),
		}).toStrictEqual({
			reportFindings: {
				verb: "Reported review findings",
				failedVerb: "Failed to report review findings",
			},
			monitor: {
				verb: "Started watching background command",
				failedVerb: "Failed to start watching background command",
			},
			taskOutput: {verb: "Read task output", failedVerb: "Failed to read task output"},
		});
	});
});

describe("ReportFindingsRenderer", () => {
	it("is the registered body for ReportFindings", () => {
		expect(getToolRenderer("ReportFindings")).not.toBe(getToolRenderer("Frobnicate"));
	});

	it("renders one finding card per finding with location, category and verdict", () => {
		const {container} = render(
			<ReportFindingsRenderer
				toolCall={makeCall(
					"ReportFindings",
					{findings: [CONFIRMED_FINDING, PLAIN_FINDING]},
					{result: "2 findings reported."},
				)}
			/>,
		);

		const cards = [...container.querySelectorAll("[data-finding-card]")];
		expect(
			cards.map((card) => ({
				title: card.querySelector("[data-finding-title]")?.textContent,
				location: card.querySelector("[data-finding-location]")?.textContent,
				category: card.querySelector("[data-finding-category]")?.textContent ?? null,
				verdict: card.querySelector("[data-finding-verdict]")?.textContent ?? null,
				body: card.querySelector("[data-finding-body]")?.textContent,
			})),
		).toStrictEqual([
			{
				title: "Example value is dropped",
				location: "src/example.ts:100",
				category: "correctness",
				verdict: "Confirmed",
				body: "The example branch drops a requested value.\n\nAlice requests the example value and receives no result.",
			},
			{
				title: "The other branch reads a stale cache.",
				location: "src/other.ts:7",
				category: null,
				verdict: null,
				body: "Bob edits the file and sees the old contents.",
			},
		]);
	});

	it("shows the failure message for a failed call", () => {
		const {container} = render(
			<ReportFindingsRenderer
				toolCall={makeCall(
					"ReportFindings",
					{findings: [CONFIRMED_FINDING]},
					{result: "Findings rejected", isError: true},
				)}
			/>,
		);

		expect({
			error: container.querySelector(".text-danger-ink")?.textContent,
			cards: container.querySelectorAll("[data-finding-card]").length,
		}).toStrictEqual({error: "Findings rejected", cards: 1});
	});
});

describe("Monitor and TaskOutput bodies", () => {
	it("route through the fallback KeyValue renderer", () => {
		expect({
			monitor: getToolRenderer("Monitor"),
			taskOutput: getToolRenderer("TaskOutput"),
		}).toStrictEqual({
			monitor: getToolRenderer("Frobnicate"),
			taskOutput: getToolRenderer("Frobnicate"),
		});
	});

	it("render the Monitor input as key/value params", () => {
		const {container} = render(
			<FallbackRenderer toolCall={makeCall("Monitor", MONITOR_INPUT, {result: "Monitor started"})} />,
		);

		expect(container.textContent).toContain("description: wait for dev server");
		expect(container.textContent).toContain("timeout_ms: 60000");
	});
});

describe("strict input schemas", () => {
	it("accept the observed ReportFindings, Monitor and TaskOutput inputs", () => {
		expect({
			reportFindings: toolInputSchemas.ReportFindings.safeParse({
				findings: [CONFIRMED_FINDING, PLAIN_FINDING],
			}).success,
			reportFindingsWithLevel: toolInputSchemas.ReportFindings.safeParse({
				level: "high",
				findings: [CONFIRMED_FINDING],
			}).success,
			monitor: toolInputSchemas.Monitor.safeParse(MONITOR_INPUT).success,
			monitorWs: toolInputSchemas.Monitor.safeParse({
				ws: {url: "ws://127.0.0.1:3100/api/v1/ladder/events"},
				description: "ladder edits",
				timeout_ms: 1800000,
			}).success,
			monitorStringTimeout: toolInputSchemas.Monitor.safeParse({
				description: "Wait for CI",
				timeout: "1000000",
			}).success,
			taskOutput: toolInputSchemas.TaskOutput.safeParse({
				task_id: "b1",
				block: true,
				timeout: 5000,
			}).success,
		}).toStrictEqual({
			reportFindings: true,
			reportFindingsWithLevel: true,
			monitor: true,
			monitorWs: true,
			monitorStringTimeout: true,
			taskOutput: true,
		});
	});

	it("reject unknown keys and unknown verdicts", () => {
		expect({
			reportFindingsTopLevel: toolInputSchemas.ReportFindings.safeParse({
				findings: [],
				extra: 1,
			}).success,
			reportFindingsFinding: toolInputSchemas.ReportFindings.safeParse({
				findings: [{...PLAIN_FINDING, severity: "high"}],
			}).success,
			reportFindingsVerdict: toolInputSchemas.ReportFindings.safeParse({
				findings: [{...PLAIN_FINDING, verdict: "MAYBE"}],
			}).success,
			monitor: toolInputSchemas.Monitor.safeParse({...MONITOR_INPUT, extra: 1}).success,
			monitorWs: toolInputSchemas.Monitor.safeParse({
				ws: {url: "ws://x", protocol: "v1"},
			}).success,
			taskOutput: toolInputSchemas.TaskOutput.safeParse({task_id: "b1", extra: 1}).success,
		}).toStrictEqual({
			reportFindingsTopLevel: false,
			reportFindingsFinding: false,
			reportFindingsVerdict: false,
			monitor: false,
			monitorWs: false,
			taskOutput: false,
		});
	});
});
