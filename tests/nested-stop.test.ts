import {describe, expect, it} from "vite-plus/test";

import {latestAgentsKilledId, nestedStopCount, nestedStopLabels} from "../src/lib/nested-stop";

describe("nestedStopCount", () =>
{
	it("counts running agents and workflows, the work the CLI's kill-agents chord stops", () =>
	{
		expect(
			{
				mixed: nestedStopCount([
					{
						kind: "agent",
						status: "running",
					},
					{
						kind: "workflow",
						status: "running",
					},
					{
						kind: "bash",
						status: "running",
					},
					{
						kind: "agent",
						status: "completed",
					},
				]),
				empty: nestedStopCount([]),
				monitorOnly: nestedStopCount([
					{
						kind: "monitor",
						status: "running",
					},
				]),
				taskOnly: nestedStopCount([
					{
						kind: "task",
						status: "running",
					},
				]),
			},
		).toStrictEqual(
			{
				mixed: 2,
				empty: 0,
				monitorOnly: 0,
				taskOnly: 0,
			},
		);
	});
});

describe("nestedStopLabels", () =>
{
	it("pluralizes upstream's nested-stop copy as background agents", () =>
	{
		expect(
			{
				one: nestedStopLabels(1),
				three: nestedStopLabels(3),
			},
		).toStrictEqual(
			{
				one:
				{
					label: "Stop 1 background agent",
					stoppingLabel: "Stopping background agents…",
					stopped: "Stopped 1 background agent.",
					notStopped: "1 background agent couldn’t be stopped. Try again.",
					failed: "Background agents couldn’t be stopped. Try again.",
				},
				three:
				{
					label: "Stop 3 background agents",
					stoppingLabel: "Stopping background agents…",
					stopped: "Stopped 3 background agents.",
					notStopped: "3 background agents couldn’t be stopped. Try again.",
					failed: "Background agents couldn’t be stopped. Try again.",
				},
			},
		);
	});
});

describe("latestAgentsKilledId", () =>
{
	it("finds the newest agents_killed system record's uuid", () =>
	{
		expect(
			{
				none: latestAgentsKilledId([
					{
						type: "user",
						uuid: "u1",
					},
				]),
				newest: latestAgentsKilledId([
					{
						type: "system",
						subtype: "agents_killed",
						uuid: "k1",
					},
					{
						type: "system",
						subtype: "turn_duration",
						uuid: "t1",
					},
					{
						type: "system",
						subtype: "agents_killed",
						uuid: "k2",
					},
					{
						type: "assistant",
						uuid: "a1",
					},
				]),
			},
		).toStrictEqual(
			{
				none: null,
				newest: "k2",
			},
		);
	});
});
