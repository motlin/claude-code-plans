import {describe, expect, it} from "vite-plus/test";
import {apiImagesReachNitroInDev} from "../src/lib/dev-api-image-requests";

function routeThrough(url: string, headers: Record<string, string>)
{
	const middlewares: ((
		req:
		{
			url?: string;
			headers: Record<string, string | undefined>;
		},
		res: unknown,
		next: () => void,
	) => void)[] = [];
	apiImagesReachNitroInDev().configureServer(
		{
			middlewares:
			{
				use: (middleware) =>
				{
					middlewares.push(middleware);
				},
			},
		},
	);
	const req =
	{
		url,
		headers:
		{
			...headers,
		},
	};
	let nexts = 0;
	for (const middleware of middlewares)
		middleware(req, {}, () =>
		{
			nexts++;
		});
	return {
		headers: req.headers,
		nexts,
	};
}

describe("apiImagesReachNitroInDev", () =>
{
	it("drops Sec-Fetch-Dest from API requests so nitro's dev middleware serves an <img> of an API route", () =>
	{
		expect([
			routeThrough(
				"/api/artifacts/abc/thumbnail?v=1",
				{
					"sec-fetch-dest": "image",
					accept: "image/*",
				},
			),
			routeThrough(
				"/assets/logo.png",
				{
					"sec-fetch-dest": "image",
				},
			),
		]).toStrictEqual([
			{
				headers:
				{
					accept: "image/*",
				},
				nexts: 1,
			},
			{
				headers:
				{
					"sec-fetch-dest": "image",
				},
				nexts: 1,
			},
		]);
	});
});
