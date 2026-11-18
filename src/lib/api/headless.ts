import {z} from "zod";

import {HerdrRequestError} from "./herdr";

const HeadlessLaunchSuccessResponse = z.strictObject(
	{
		ok: z.literal(true),
		sessionId: z.string(),
	},
);

const HeadlessLaunchErrorResponse = z.strictObject(
	{
		error: z.string(),
		code: z.string().optional(),
	},
);

export type HeadlessLaunchResponse = z.infer<typeof HeadlessLaunchSuccessResponse>;

/** Start an app-owned headless session (`claude -p` over stream-json) rooted at `cwd`. */
export async function launchHeadlessSession(
	launch:
	{
		cwd?: string;
		prompt?: string;
		args?: string[];
	},
	fetcher: typeof fetch = fetch,
): Promise<HeadlessLaunchResponse>
{
	const response = await fetcher(
		"/api/headless/launch",
		{
			method: "POST",
			credentials: "same-origin",
			headers:
			{
				"Content-Type": "application/json",
			},
			body: JSON.stringify(launch),
		},
	);
	const json: unknown = await response.json();
	if (!response.ok)
	{
		const {error, code} = HeadlessLaunchErrorResponse.parse(json);
		throw new HerdrRequestError(error, response.status, code);
	}
	return HeadlessLaunchSuccessResponse.parse(json);
}
