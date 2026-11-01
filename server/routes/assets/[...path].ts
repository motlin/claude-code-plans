import {dirname, resolve} from "node:path";
import {defineHandler, HTTPError} from "nitro";
import {readPreviousAsset} from "../../../src/lib/previous-assets";

// Nitro's static handler serves this build's /assets first; a request only lands here for a hashed chunk this build
// doesn't have, usually one an open tab from the previous deploy is lazily importing.
function previousAssetsDir(): string {
	// scripts/server.sh runs `node <snapshot>/.output/server/index.mjs`, so previous-assets sits beside server/.
	return resolve(dirname(process.argv[1] ?? ""), "..", "previous-assets");
}

export default defineHandler(async (event) => {
	const asset = await readPreviousAsset(previousAssetsDir(), event.url.pathname);
	if (asset === null) throw new HTTPError({status: 404});
	return new Response(new Uint8Array(asset.body), {headers: asset.headers});
});
