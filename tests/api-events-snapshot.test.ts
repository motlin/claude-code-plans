import {describe, expect, it} from "vite-plus/test";
import {sseClientCount} from "../src/lib/sse-broadcast";
import {Route as EventsRoute} from "../src/routes/api/events";

type ApiHandler = (context: {request: Request}) => Response | Promise<Response>;

const handler = (EventsRoute as unknown as {options: {server: {handlers: Record<string, ApiHandler>}}}).options.server
	.handlers["GET"]!;

describe("GET /api/events?snapshot", () => {
	it("answers with the events a fresh stream sends on connect, as JSON, without joining the stream", async () => {
		const before = sseClientCount();

		const response = await handler({request: new Request("http://localhost/api/events?snapshot")});

		expect({
			contentType: response.headers.get("Content-Type"),
			body: await response.json(),
			clients: sseClientCount(),
		}).toStrictEqual({
			contentType: "application/json",
			body: [{type: "subagents:snapshot", data: '{"subagents":[]}'}],
			clients: before,
		});
	});
});
