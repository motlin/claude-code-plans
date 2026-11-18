import {homedir} from "node:os";

import {terminalWritesEnabled} from "../config";
import {HerdrLaunchRequestSchema} from "../herdr/launch";
import {rejectCrossSite} from "../same-origin-guard";
import {getHeadlessRegistry, type HeadlessLaunch} from "./registry";

export interface HeadlessLaunchDependencies
{
	rejectRequest: (request: Request) => Response | null;
	writesEnabled: () => boolean;
	homeDir: () => string;
	launch: (launch: HeadlessLaunch) =>
	{
		sessionId: string;
	};
}

const defaultHeadlessLaunchDependencies: HeadlessLaunchDependencies =
{
	rejectRequest: rejectCrossSite,
	writesEnabled: terminalWritesEnabled,
	homeDir: homedir,
	launch: (launch) => getHeadlessRegistry().launch(launch),
};

/**
 * POST: start an app-owned headless session, the same `{cwd, prompt, args}` a
 * pane launch takes. Answers with the new session id at once; the transcript
 * appears as the CLI writes its JSONL.
 */
export async function handleHeadlessLaunch(
	request: Request,
	dependencies: HeadlessLaunchDependencies = defaultHeadlessLaunchDependencies,
): Promise<Response>
{
	const rejection = dependencies.rejectRequest(request);
	if (rejection) return rejection;
	if (!dependencies.writesEnabled())
		return Response.json(
			{
				error: "Live terminal input is off",
			},
			{
				status: 403,
			},
		);
	const parsed = HerdrLaunchRequestSchema.safeParse(await request.json());
	if (!parsed.success)
		return Response.json(
			{
				error: parsed.error.issues[0]?.message ?? "Invalid launch request",
			},
			{
				status: 400,
			},
		);
	const {cwd = dependencies.homeDir(), prompt, args} = parsed.data;
	const {sessionId} = dependencies.launch(
		{
			cwd,
			...(prompt === undefined
				? {}
				:
					{
						prompt,
					}),
			...(args === undefined
				? {}
				:
					{
						args,
					}),
		},
	);
	return Response.json(
		{
			ok: true,
			sessionId,
		},
	);
}
