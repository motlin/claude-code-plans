// nitro's dev middleware sends any request whose Sec-Fetch-Dest names a subresource (image, script, …) to Vite's
// static handling instead of the app, so in `vp dev` an <img> of an API route (`/api/image`, an artifact thumbnail)
// 404s "Cannot GET" while a fetch of the same URL works. The production server routes by path alone.

interface DevRequest
{
	url?: string;
	headers: Record<string, string | string[] | undefined>;
}

interface DevServerLike
{
	middlewares:
	{
		use(middleware: (req: DevRequest, res: unknown, next: () => void) => void): void;
	};
}

interface DevPlugin
{
	name: string;
	apply: "serve";
	configureServer(server: DevServerLike): void;
}

/** Lets API routes answer subresource requests in dev. Must come before nitro() so it runs first. */
export function apiImagesReachNitroInDev(): DevPlugin
{
	return {
		name: "ccp:api-images-reach-nitro",
		apply: "serve",
		configureServer(server)
		{
			server.middlewares.use((req, _res, next) =>
			{
				if (req.url?.startsWith("/api/") === true) delete req.headers["sec-fetch-dest"];
				next();
			});
		},
	};
}
