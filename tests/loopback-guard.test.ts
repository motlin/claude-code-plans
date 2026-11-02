import {describe, expect, it} from "vite-plus/test";
import {rejectNonLoopbackPeer} from "../src/lib/loopback-guard";
import loopbackOnly from "../server/middleware/loopback-only";

async function describeResponse(response: Response | null | undefined): Promise<null |
{
	body: unknown;
	status: number;
}>
{
	if (response === null || response === undefined) return null;
	return {
		body: await response.json(),
		status: response.status,
	};
}

const FORBIDDEN =
{
	body:
	{
		error: "This server only answers requests from this computer",
	},
	status: 403,
};

describe("rejectNonLoopbackPeer", () =>
{
	it("serves every loopback peer: Caddy over IPv4, browsers over IPv6, hooks, and IPv4-mapped sockets", async () =>
	{
		const peers = ["127.0.0.1", "127.0.0.2", "::1", "::ffff:127.0.0.1"];
		const results = await Promise.all(
			peers.map(async (ip) =>
				describeResponse(
					rejectNonLoopbackPeer(
						ip,
						{
							allowMissing: false,
						},
					),
				),
			),
		);
		expect(results).toStrictEqual([null, null, null, null]);
	});

	it("rejects a LAN peer that sends no Origin or Sec-Fetch-Site", async () =>
	{
		const peers = ["192.168.1.20", "10.0.0.5", "fe80::1", "::ffff:192.168.1.20", "", "128.0.0.1"];
		const results = await Promise.all(
			peers.map(async (ip) =>
				describeResponse(
					rejectNonLoopbackPeer(
						ip,
						{
							allowMissing: false,
						},
					),
				),
			),
		);
		expect(results).toStrictEqual([FORBIDDEN, FORBIDDEN, FORBIDDEN, FORBIDDEN, FORBIDDEN, FORBIDDEN]);
	});

	it("fails closed on a missing peer address unless the caller allows it", async () =>
	{
		const results = await Promise.all([
			describeResponse(
				rejectNonLoopbackPeer(
					undefined,
					{
						allowMissing: false,
					},
				),
			),
			describeResponse(
				rejectNonLoopbackPeer(
					undefined,
					{
						allowMissing: true,
					},
				),
			),
			describeResponse(
				rejectNonLoopbackPeer(
					"192.168.1.20",
					{
						allowMissing: true,
					},
				),
			),
		]);
		expect(results).toStrictEqual([FORBIDDEN, null, FORBIDDEN]);
	});
});

describe("loopback-only middleware", () =>
{
	function eventFrom(ip: string | undefined, headers: Record<string, string> = {})
	{
		const req = Object.assign(
			new Request(
				"http://plans.m4.notlin.com/api/settings/settings.json",
				{
					headers,
				},
			),
			{
				ip,
			},
		);
		return {
			req,
		} as unknown as Parameters<typeof loopbackOnly>[0];
	}
	// The middleware never calls on to the route, so the next handler is never reached.
	const next = (() =>
	{
		throw new Error("unreachable");
	}) as Parameters<typeof loopbackOnly>[1];

	it("rejects a LAN PUT and passes through Caddy's proxied request with forwarded headers", async () =>
	{
		const lan = await describeResponse(
			(await loopbackOnly(eventFrom("192.168.1.20"), next)) as Response | undefined,
		);
		const proxied = await loopbackOnly(
			eventFrom(
				"127.0.0.1",
				{
					Host: "plans.m4.notlin.com",
					"X-Forwarded-For": "100.64.0.7",
					"X-Forwarded-Host": "plans.m4.notlin.com",
					"X-Forwarded-Proto": "https",
				},
			),
			next,
		);
		expect(
			{
				lan,
				proxied,
			},
		).toStrictEqual(
			{
				lan: FORBIDDEN,
				proxied: undefined,
			},
		);
	});

	it("refuses a LAN WebSocket upgrade instead of letting crossws upgrade with no hooks", async () =>
	{
		// Nitro resolves an upgrade's hooks from the fetch response's `crossws`; a bare 403 resolves to none,
		// and the socket would still open.
		const response = (await loopbackOnly(
			eventFrom(
				"192.168.1.20",
				{
					Connection: "Upgrade",
					Upgrade: "websocket",
				},
			),
			next,
		)) as Response &
		{
			crossws?:
			{
				upgrade?: () => Response;
			};
		};
		const upgrade = response.crossws?.upgrade?.();
		expect(await describeResponse(upgrade)).toStrictEqual(FORBIDDEN);
	});
});
