import {describe, expect, it} from "vite-plus/test";
import {senderForSocket, socketPathOf, type PeerSenderEntry} from "../src/lib/peer-sender";

const ENTRY: PeerSenderEntry =
{
	messagingSocketPath: "/tmp/cc-socks/73436.sock",
	sessionId: "S2",
	startedAt: Date.parse("2026-11-01T10:00:00.000Z"),
	title: "Fix login",
};

describe("senderForSocket", () =>
{
	it("maps a uds sender to the registry entry that owned its socket when the message was sent", () =>
	{
		const from = "uds:/tmp/cc-socks/73436.sock";

		expect(
			{
				found: senderForSocket([ENTRY], from, "2026-11-01T10:05:00.000Z"),
				noTimestamp: senderForSocket([ENTRY], from, undefined)?.sessionId,
				missing: senderForSocket([], from, "2026-11-01T10:05:00.000Z"),
				notUds: senderForSocket([ENTRY], "/tmp/cc-socks/73436.sock", "2026-11-01T10:05:00.000Z"),
				pidReused: senderForSocket([ENTRY], from, "2026-11-01T09:59:59.000Z"),
				sockets: [socketPathOf(from), socketPathOf("a0123456789abcdef")],
			},
		).toStrictEqual(
			{
				found: ENTRY,
				noTimestamp: "S2",
				missing: undefined,
				notUds: undefined,
				pidReused: undefined,
				sockets: ["/tmp/cc-socks/73436.sock", undefined],
			},
		);
	});
});
