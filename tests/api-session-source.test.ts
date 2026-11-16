import {describe, expect, it, vi} from "vite-plus/test";

type ApiHandler = (context: {
	params:
	{
		id: string;
		uuid: string;
	};
	request: Request;
}) => Response | Promise<Response>;

const SESSION_ID = "11111111-2222-3333-4444-555555555555";
const FOCAL_UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const FOCAL_RAW = JSON.stringify(
	{
		uuid: FOCAL_UUID,
		type: "user",
	},
);

vi.mock("../src/lib/sessions", () => (
{
	readSession: async () => Promise.resolve(null),
	readSessionRawWindow: async () =>
		Promise.resolve(
			{
				before: [],
				focal:
				{
					raw: FOCAL_RAW,
					lineIndex: 0,
					uuid: FOCAL_UUID,
				},
				after: [],
			},
		),
}));
vi.mock("../src/lib/db", () => (
{
	getDb: () =>
	{
		throw new Error("no db");
	},
}));

describe("GET /api/sessions/$id/source/$uuid", () =>
{
	it("titles a session whose detail cannot be read Untitled, never by its id", async () =>
	{
		const {Route} = await import("../src/routes/api/sessions.$id.source.$uuid");
		const get = (
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
		).options.server.handlers["GET"]!;

		const response = await get(
			{
				params:
				{
					id: SESSION_ID,
					uuid: FOCAL_UUID,
				},
				request: new Request(`http://localhost/api/sessions/${SESSION_ID}/source/${FOCAL_UUID}`),
			},
		);

		expect(await response.json()).toStrictEqual(
			{
				window:
				{
					before: [],
					focal:
					{
						raw: FOCAL_RAW,
						lineIndex: 0,
						uuid: FOCAL_UUID,
					},
					after: [],
				},
				parsedBlocksJson: "[]",
				parsedBlocksCount: 0,
				paired: null,
				sessionTitle: "Untitled",
				knownUuids: [FOCAL_UUID],
			},
		);
	});
});
