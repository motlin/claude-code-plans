import {describe, expect, it} from "vite-plus/test";
import {approvalPlacement, placementDrawsQueue} from "../src/lib/approval-placement";

describe("approvalPlacement (upstream Z_/$_)", () =>
{
	const base =
	{
		inlineApprovals: true,
		isReadOnly: false,
		aboveTurnBox: false,
		clusterLive: false,
	};

	it("picks the card's placement in upstream's order, and only the queue-drawing ones hide queued rows", () =>
	{
		const placements =
		{
			classic: approvalPlacement(
				{
					...base,
					inlineApprovals: false,
					isReadOnly: true,
				},
			),
			readOnly: approvalPlacement(
				{
					...base,
					isReadOnly: true,
					aboveTurnBox: true,
				},
			),
			aboveTurnBox: approvalPlacement(
				{
					...base,
					aboveTurnBox: true,
					clusterLive: true,
				},
			),
			clusterLive: approvalPlacement(
				{
					...base,
					clusterLive: true,
				},
			),
			otherwise: approvalPlacement(base),
		};
		expect(
			{
				placements,
				drawsQueue: Object.fromEntries(
					Object.entries(placements).map(([name, placement]) => [name, placementDrawsQueue(placement)]),
				),
			},
		).toStrictEqual(
			{
				placements:
				{
					classic: undefined,
					readOnly: "no-card",
					aboveTurnBox: "card-above-turn-box",
					clusterLive: "card-and-queue-at-tail",
					otherwise: "card-at-tail",
				},
				drawsQueue:
				{
					classic: false,
					readOnly: false,
					aboveTurnBox: true,
					clusterLive: true,
					otherwise: false,
				},
			},
		);
	});
});
