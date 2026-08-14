import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { MarkdownView } from "../components/markdown-view";
import { memoryDetailQueryOptions, useRemoveMemory } from "../lib/api/memories";
import { fromMdSlug } from "../lib/md-slug";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { DetailTopBar, pillStyles } from "../components/detail-top-bar";
import { DebugLink } from "../components/debug-link";
import { useCallback, useState } from "react";

export const Route = createFileRoute("/memory/$project/$filename")({
  component: MemoryPage,
  loader: ({ context: { queryClient }, params }) =>
    queryClient.ensureQueryData(memoryDetailQueryOptions(params.project, params.filename)),
  head: ({ params }) => ({
    meta: [{ title: fromMdSlug(params.filename) }],
  }),
});

function MemoryPage() {
  const { project, filename: slug } = Route.useParams();
  const filename = fromMdSlug(slug);
  const { data } = useSuspenseQuery(memoryDetailQueryOptions(project, slug));
  const navigate = useNavigate();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const removeMutation = useRemoveMemory(project, slug);
  const deleting = removeMutation.isPending;

  const handleDelete = useCallback(async () => {
    try {
      const result = await removeMutation.mutateAsync();
      if (result.ok) {
        void navigate({ to: "/memories" });
        return;
      }
    } catch {
      // fall through
    }
    setConfirmingDelete(false);
  }, [removeMutation, navigate]);

  if (!data) {
    return (
      <div>
        <DetailTopBar>
          <Link to="/memories" className={pillStyles.primary}>
            <ArrowLeft className="h-3.5 w-3.5" />
            All Memories
          </Link>
        </DetailTopBar>
        <h1 className="mt-4 text-lg font-semibold">Memory Not Found</h1>
        <p className="mt-2 text-t6">This memory file could not be found.</p>
      </div>
    );
  }

  return (
    <div>
      <DetailTopBar>
        <Link to="/memories" className={pillStyles.primary}>
          <ArrowLeft className="h-3.5 w-3.5" />
          All Memories
        </Link>
        <span className="text-xs text-t6">{data.projectName}</span>
        <Link
          to="/memory/$project/$filename/edit"
          params={{ project, filename: slug }}
          className={pillStyles.outline}
        >
          <Pencil className="h-3 w-3" />
          Edit
        </Link>
        <DebugLink kind="memory" relativePath={`${project}/memory/${filename}`} />
        {confirmingDelete ? (
          <span className="inline-flex items-center gap-1.5 text-xs">
            <span className="text-danger-000">Delete this memory?</span>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="rounded bg-danger-000 px-2 py-1 text-xs font-medium text-white hover:bg-danger-000/80 disabled:opacity-50"
            >
              {deleting ? "Deleting..." : "Yes, delete"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              className={pillStyles.outline}
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className={`${pillStyles.outline} text-danger-000 hover:bg-danger-000/10`}
          >
            <Trash2 className="h-3 w-3" />
            Delete
          </button>
        )}
      </DetailTopBar>
      <div className="mt-4">
        <MarkdownView
          markdown={data.markdown}
          mdLinkBase={`/memory/${encodeURIComponent(project)}`}
        />
      </div>
    </div>
  );
}
