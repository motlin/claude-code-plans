import {describe, expect, it} from "vite-plus/test";
import {renderToStaticMarkup} from "react-dom/server";
import {ContinuedInBanner, DerivedFromBanner} from "../src/components/continued-in-banner";

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

	it("links to each session this one was derived from, naming how", () =>
	{
		const html = renderToStaticMarkup(
			<DerivedFromBanner
				line={
				{
					type: "derived-from",
					sessions: [
						{
							id: "session-alice-050",
							via: "compact",
						},
						{
							id: "session-alice-060",
							via: "resume",
						},
					],
					lineIndex: 0,
				}}
			/>,
		);
		const links = Array.from(html.matchAll(/<a href="([^"]*)"[^>]*>([^<]*)<\/a>/g), ([, href, text]) => [
			href,
			text,
		]);
		expect(links).toStrictEqual([
			["/session/session-alice-050", "Compacted from an earlier session"],
			["/session/session-alice-060", "Resumed from an earlier session"],
		]);
	});
});
