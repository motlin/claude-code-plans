import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { CustomizeHeader } from "../components/customize/customize-header";
import { customizeSearchSchema, sectionForPathname } from "../components/customize/sections";

export const Route = createFileRoute("/customize")({
  component: CustomizeLayout,
  validateSearch: customizeSearchSchema,
  head: () => ({ meta: [{ title: "Customize" }] }),
});

/**
 * Shell for every `/customize/<section>` page: the shared header (tabs,
 * Yours | Discover, search, Filter, Sort) above the section body. It renders
 * `<Outlet />` for the section routes nested under it.
 */
function CustomizeLayout() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const search = Route.useSearch();
  const section = sectionForPathname(pathname);

  return (
    <div
      data-testid="customize-page"
      className="flex w-full flex-col bg-surface-1 text-body text-primary"
    >
      <div className="mx-auto w-full max-w-5xl pb-6">
        <CustomizeHeader section={section} search={search} />
      </div>
      <div
        id="customize-pane"
        role="tabpanel"
        aria-labelledby={`customize-tab-${section.id}`}
        className="mx-auto w-full max-w-5xl"
      >
        <Outlet />
      </div>
    </div>
  );
}
