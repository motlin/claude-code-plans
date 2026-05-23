import { Suspense } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { pluginFileQueryOptions } from "../lib/api/plugins";
import { MarkdownSkeleton, MarkdownView } from "../components/markdown-view";
import { ArrowLeft } from "lucide-react";
import { DetailTopBar, pillStyles } from "../components/detail-top-bar";

function buildPathSegments(type: string, splat: string | undefined): string[] {
  return [type, ...(splat ?? "").split("/")];
}

export const Route = createFileRoute("/plugin/$id/$type/$")({
  component: PluginFilePage,
  loader: ({ context: { queryClient }, params }) =>
    queryClient.ensureQueryData(
      pluginFileQueryOptions(params.id, buildPathSegments(params.type, params._splat)),
    ),
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData?.title ?? "Plugin File" }],
  }),
});

function FrontmatterBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded-md bg-bg-200/60 px-2.5 py-1 text-xs">
      <span className="font-medium text-text-400">{label}</span>
      <span className="text-text-200">{value}</span>
    </div>
  );
}

function PluginFilePage() {
  const { id, type, _splat } = Route.useParams();
  const { data } = useSuspenseQuery(pluginFileQueryOptions(id, buildPathSegments(type, _splat)));

  if (!data) {
    return (
      <div>
        <DetailTopBar>
          <Link to="/plugins" className={pillStyles.primary}>
            <ArrowLeft className="h-3.5 w-3.5" />
            All Plugins
          </Link>
        </DetailTopBar>
        <h1 className="mt-4 text-lg font-semibold">File Not Found</h1>
        <p className="mt-2 text-text-500">This plugin file could not be found.</p>
      </div>
    );
  }

  const fm = data.frontmatter;
  const badges = Object.entries(fm).filter(
    ([key]) => !["name", "description"].includes(key) && fm[key],
  );

  return (
    <div>
      <DetailTopBar>
        <Link to="/plugins" className={pillStyles.primary}>
          <ArrowLeft className="h-3.5 w-3.5" />
          All Plugins
        </Link>
        <span className="text-xs text-text-500">{id.split("@")[0]}</span>
      </DetailTopBar>

      {fm["description"] && <p className="mt-3 text-sm text-text-400">{fm["description"]}</p>}

      {badges.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {badges.map(([key, value]) => (
            <FrontmatterBadge key={key} label={key} value={value} />
          ))}
        </div>
      )}

      <div className="mt-4">
        <Suspense fallback={<MarkdownSkeleton />}>
          <MarkdownView markdown={data.markdown} />
        </Suspense>
      </div>
    </div>
  );
}
