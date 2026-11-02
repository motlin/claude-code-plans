import {describe, expect, it} from "vite-plus/test";
import {HerdrConnectionResponse, herdrConnectionQueryOptions} from "../src/lib/api/herdr-connection";
import {herdrReconnectState} from "../src/lib/herdr/reconnect-state";
import {Route} from "../src/routes/api/herdr-connection";

type ApiHandler = (context: {request: Request}) => Response | Promise<Response>;

async function getConnection(): Promise<unknown>
{
	const {handlers} = (
		Route as unknown as
		{
			options:
			{
				server:
				{
					handlers: Record<string, ApiHandler>;
				};
			};
		}
	).options.server;
	const response = await handlers["GET"]!(
		{
			request: new Request("http://localhost/api/herdr-connection"),
		},
	);
	return response.json();
}

describe("herdr connection API", () =>
{
	it("serves whether the herdr subscription is reconnecting under a stable query key", async () =>
	{
		const idle = await getConnection();
		herdrReconnectState.set("/test/herdr.sock", true);
		const reconnecting = await getConnection();
		herdrReconnectState.set("/test/herdr.sock", false);

		expect(
			{
				idle,
				reconnecting,
				queryKey: herdrConnectionQueryOptions.queryKey,
			},
		).toStrictEqual(
			{
				idle:
				{
					reconnecting: false,
				},
				reconnecting:
				{
					reconnecting: true,
				},
				queryKey: ["herdr", "connection"],
			},
		);
	});

	it("rejects fields outside the ccp-owned response contract", () =>
	{
		expect(
			HerdrConnectionResponse.safeParse(
				{
					reconnecting: false,
					unexpectedTestField: true,
				},
			).success,
		).toBe(false);
	});
});
