import {createFileRoute} from "@tanstack/react-router";
import {SearchView} from "../components/search-view";
import {UnifiedSearchTypeSchema, type UnifiedSearchType} from "../lib/api/search";

export const Route = createFileRoute("/search")({
	component: SearchPage,
	validateSearch: validateSearchParameters,
	head: () => ({
		meta: [{title: "Search"}],
	}),
});

export function validateSearchParameters(search: Record<string, unknown>): {
	q: string;
	type: UnifiedSearchType;
} {
	// Old links carried `mode=titles|conversations|files`; only files survives, as a type.
	const raw = search["type"] ?? (search["mode"] === "files" ? "files" : "all");
	const type = UnifiedSearchTypeSchema.safeParse(raw);
	if (!type.success) {
		throw new Error(
			`Unknown search type ${JSON.stringify(raw)}: expected ${UnifiedSearchTypeSchema.options.join(", ")}`,
		);
	}
	return {
		q: typeof search["q"] === "string" ? search["q"] : "",
		type: type.data,
	};
}

function SearchPage() {
	const {q, type} = Route.useSearch();
	return <SearchView q={q} type={type} />;
}
