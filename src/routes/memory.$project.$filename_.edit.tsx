import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { memoryDetailQueryOptions, useSaveMemory } from "../lib/api/memories";
import { fromMdSlug } from "../lib/md-slug";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";

const MarkdownEditor = lazy(() =>
  import("../components/markdown-editor").then((m) => ({
    default: m.MarkdownEditor,
  })),
);

export const Route = createFileRoute("/memory/$project/$filename_/edit")({
  component: MemoryEditPage,
  loader: ({ context: { queryClient }, params }) =>
    queryClient.ensureQueryData(memoryDetailQueryOptions(params.project, params.filename)),
  head: ({ params }) => ({
    meta: [{ title: `Edit: ${fromMdSlug(params.filename)}` }],
  }),
});

function MemoryEditPage() {
  const { project, filename: slug } = Route.useParams();
  const { data } = useSuspenseQuery(memoryDetailQueryOptions(project, slug));
  const saveMutation = useSaveMemory(project, slug);
  const saving = saveMutation.isPending;

  const initialMarkdown = data?.markdown ?? "";
  const draftRef = useRef(initialMarkdown);

  useEffect(() => {
    draftRef.current = initialMarkdown;
  }, [initialMarkdown]);

  const [feedback, setFeedback] = useState<string | null>(null);

  const handleChange = useCallback((value: string) => {
    draftRef.current = value;
  }, []);

  const navigate = useNavigate();

  const doSave = useCallback(async () => {
    try {
      return await saveMutation.mutateAsync(draftRef.current);
    } catch {
      return { ok: false };
    }
  }, [saveMutation]);

  const handleSave = useCallback(async () => {
    setFeedback(null);
    const result = await doSave();
    setFeedback(result.ok ? "Saved" : "Failed to save");
  }, [doSave]);

  const handlePreview = useCallback(async () => {
    const result = await doSave();
    if (result.ok) {
      void navigate({
        to: "/memory/$project/$filename",
        params: { project, filename: slug },
      });
    }
  }, [doSave, navigate, project, slug]);

  if (!data) {
    return (
      <div>
        <Link to="/memories" className="text-sm text-accent-100 hover:underline">
          &larr; All Memories
        </Link>
        <h1 className="mt-4 text-lg font-semibold">Memory Not Found</h1>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <Link to="/memories" className="text-sm text-accent-100 hover:underline">
          &larr; All Memories
        </Link>
        <button
          type="button"
          onClick={handlePreview}
          className="text-sm text-accent-100 hover:underline"
        >
          Preview
        </button>
        <span className="text-xs text-text-500">{data.projectName}</span>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded bg-accent-100 px-3 py-1 text-sm text-bg-000 hover:bg-accent-100/90 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        {feedback && (
          <span
            className={`text-sm ${feedback === "Saved" ? "text-success-000" : "text-danger-000"}`}
          >
            {feedback}
          </span>
        )}
      </div>
      <Suspense fallback={<div className="text-text-500 text-sm">Loading editor...</div>}>
        <MarkdownEditor key={initialMarkdown} markdown={initialMarkdown} onChange={handleChange} />
      </Suspense>
    </div>
  );
}
