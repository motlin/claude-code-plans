import {describe, expect, it} from "vite-plus/test";

import {nextRespondingHere, type RespondingHereSignal} from "../src/lib/responding-here";

function run(signals: readonly RespondingHereSignal[]): boolean[]
{
	const seen: boolean[] = [];
	let here = false;
	for (const signal of signals)
	{
		here = nextRespondingHere(here, signal);
		seen.push(here);
	}
	return seen;
}

const working: RespondingHereSignal =
{
	status: "working",
	sessionState: "working",
	sending: false,
};
const questionWait: RespondingHereSignal =
{
	status: "idle",
	sessionState: "waiting",
	sending: false,
};
const permissionWait: RespondingHereSignal =
{
	status: "waiting",
	sessionState: "waiting",
	sending: false,
};
const stopped: RespondingHereSignal =
{
	status: "idle",
	sessionState: "idle",
	sending: false,
};
const sending: RespondingHereSignal =
{
	status: "idle",
	sessionState: "idle",
	sending: true,
};
const stopping: RespondingHereSignal =
{
	status: "stopping",
	sessionState: "working",
	sending: false,
};

describe("nextRespondingHere", () =>
{
	it("arms on a turn this page saw working or sent, holds through a wait on the user, and clears when the turn stops", () =>
	{
		expect([
			run([working, questionWait]),
			run([working, permissionWait]),
			run([questionWait]),
			run([permissionWait]),
			run([working, questionWait, stopped]),
			run([sending, questionWait]),
			run([stopping, questionWait]),
		]).toStrictEqual([
			[true, true],
			[true, true],
			[false],
			[false],
			[true, true, false],
			[true, true],
			[true, true],
		]);
	});
});
