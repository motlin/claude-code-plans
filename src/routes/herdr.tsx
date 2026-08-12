import { createFileRoute, Outlet, useParams } from "@tanstack/react-router";
import { HerdrWorkspaceRail } from "../components/herdr-workspace-rail";
import { herdrWorkspacesQueryOptions } from "../lib/api/herdr-workspaces";

export const Route = createFileRoute("/herdr")({
  component: HerdrLayout,
  loader: ({ context: { queryClient } }) =>
    queryClient.ensureQueryData(herdrWorkspacesQueryOptions),
});

/**
 * Master-detail shell for every `/herdr` view.
 *
 * Flat file routing makes this the parent of `herdr.index` and
 * `herdr.terminal.$sessionId`, so it MUST render `<Outlet />`: a parent with a
 * component but no outlet silently swallows its children, leaving the URL and
 * title updated while the child never mounts. `tests/route-parents-render-outlet.test.ts`
 * guards that invariant.
 */
function HerdrLayout() {
  const params = useParams({ strict: false });
  const selectedSessionId = params.sessionId ?? null;

  return (
    <div className="-mx-4 flex sm:-mx-8">
      <HerdrWorkspaceRail selectedSessionId={selectedSessionId} />
      <div className="min-w-0 flex-1 px-4 sm:px-8">
        <Outlet />
      </div>
    </div>
  );
}
