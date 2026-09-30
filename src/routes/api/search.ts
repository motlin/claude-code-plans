import {createFileRoute} from "@tanstack/react-router";
import type {BetterSQLite3Database} from "drizzle-orm/better-sqlite3";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";
import {UnifiedSearchParamsSchema, UnifiedSearchResponse} from "../../lib/api/search";
import type * as schema from "../../lib/db/schema";
import {searchUnifiedDb} from "../../lib/db/search-unified";

const PRIVATE_NO_CACHE = "private, max-age=0, must-revalidate";

function jsonResponse(body: unknown, status = 200): Response {
	return Response.json(body, {status, headers: {"Cache-Control": PRIVATE_NO_CACHE}});
}

export function handleUnifiedSearchRequest(
	request: Request,
	db: BetterSQLite3Database<typeof schema>,
	now: number,
): Response {
	const parsed = UnifiedSearchParamsSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
	if (!parsed.success) {
		return jsonResponse({error: parsed.error.issues.map((issue) => issue.message)}, 400);
	}
	return jsonResponse(UnifiedSearchResponse.parse({items: searchUnifiedDb(db, parsed.data, now)}));
}

export const Route = createFileRoute("/api/search")({
	server: {
		handlers: withMethodNotAllowed({
			GET: async ({request}: {request: Request}) => {
				const {getDb} = await import("../../lib/db");
				return handleUnifiedSearchRequest(request, getDb().index, Date.now());
			},
		}),
	},
});
