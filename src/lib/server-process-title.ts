export const SERVER_PROCESS_TITLE = "claude-code-browser-server";

// scripts/server.sh finds the production server by this title (SERVER_TITLE)
// and passes its own SERVER_TITLE in the environment, so a test run can give
// its server a title no real server has. Keep the default in sync with the
// script's. Dev mode keeps the title vite.config.ts sets.
export function setServerProcessTitle({
	dev,
	env = process.env,
}: {
	dev: boolean;
	env?: Readonly<Record<string, string | undefined>>;
}): void
{
	if (!dev)
	{
		const title = env["SERVER_TITLE"];
		process.title = title === undefined || title === "" ? SERVER_PROCESS_TITLE : title;
	}
}
