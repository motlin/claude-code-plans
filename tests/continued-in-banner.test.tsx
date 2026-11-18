import {describe, expect, it} from "vite-plus/test";
import {renderToStaticMarkup} from "react-dom/server";
import {ContinuedInBanner} from "../src/components/continued-in-banner";

describe("ContinuedInBanner", () =>
{
	it("links to the session this one was continued in", () =>
	{
		const html = renderToStaticMarkup(
			<ContinuedInBanner
				line={
				{
					type: "continued-in",
					continuedInSessionId: "session-alice-200",
					timestamp: "2000-01-01T00:00:00.000Z",
					lineIndex: 0,
				}}
			/>,
		);
		const links = Array.from(html.matchAll(/<a href="([^"]*)"[^>]*>([^<]*)<\/a>/g), ([, href, text]) => [
			href,
			text,
		]);
		expect(links).toStrictEqual([["/session/session-alice-200", "Continued in a new session"]]);
	});
});
