import {createFileRoute, Outlet, useLocation, useNavigate} from "@tanstack/react-router";
import {CustomizeHeader} from "../components/customize/customize-header";
import {routeOptions} from "../components/customize/customize-navigation";
import {CustomizeUnifiedSearch} from "../components/customize/customize-unified-search";
import {
	type CustomizeSearch,
	customizeSearchSchema,
	dropEmpty,
	sectionForPathname,
} from "../components/customize/sections";

export const Route = createFileRoute("/customize")({
	component: CustomizeLayout,
	validateSearch: customizeSearchSchema,
	head: () => ({meta: [{title: "Customize"}]}),
	staticData: {pageGutter: "tight"},
});

/**
 * Shell for every `/customize/<section>` page: the shared header (tabs,
 * Yours | Discover, search, Filter, Sort), pinned while the list scrolls, above the section body. It renders
 * `<Outlet />` for the section routes nested under it, except while `?q=` holds a
 * query: then every section and view shows upstream's unified results instead.
 */
function CustomizeLayout() {
	const pathname = useLocation({select: (location) => location.pathname});
	const search = Route.useSearch();
	const section = sectionForPathname(pathname);
	const navigate = useNavigate();
	const updateSearch = (patch: Partial<CustomizeSearch>) =>
		void navigate({
			from: Route.fullPath,
			to: section.to,
			search: (previous: CustomizeSearch) => dropEmpty({...previous, ...patch}),
			replace: true,
		});

	return (
		<div data-testid="customize-page" className="flex w-full flex-col bg-surface-1 text-body text-primary">
			{/* Upstream's sticky `customize-crumb-bar` and PageHeader: the negative margin pulls the
			    header over the root's empty top row so the band behind the sidebar trigger pins with it. */}
			<div className="sticky top-0 z-10 mx-auto -mt-12 w-full max-w-5xl bg-surface-1 px-4 pt-12 pb-6 sm:-mt-9 md:px-8">
				<CustomizeHeader section={section} search={search} onSearchChange={updateSearch} />
			</div>
			<div
				id="customize-pane"
				role="tabpanel"
				aria-labelledby={`customize-tab-${section.id}`}
				className="mx-auto w-full max-w-5xl px-4 md:px-8"
			>
				{search.q === undefined || search.q === "" ? (
					<Outlet />
				) : (
					<CustomizeUnifiedSearch
						q={search.q}
						surface="page"
						onOpen={(hit) => {
							if (hit.open === null) return;
							if (hit.open.kind === "external") {
								window.open(hit.open.href, "_blank", "noopener,noreferrer");
								return;
							}
							void navigate(routeOptions(hit.open));
						}}
					/>
				)}
			</div>
		</div>
	);
}
