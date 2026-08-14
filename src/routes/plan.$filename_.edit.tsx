import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { planQueryOptions } from "../lib/api/plans";
import { apiFetch } from "../lib/api/client";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";

const MarkdownEditor = lazy(() =>
  import("../components/markdown-editor").then((m) => ({
    default: m.MarkdownEditor,
  })),
);

const PlanSaveResponse = z.object({
  title: z.string(),
});

export const Route = createFileRoute("/plan/$filename_/edit")({
  component: PlanEditPage,
  loader: ({ context: { queryClient }, params }) =>
    queryClient.ensureQueryData(planQueryOptions(params.filename)),
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData ? `Edit: ${loaderData.title}` : "Plan Not Found" }],
  }),
});

function PlanEditPage() {
  const { filename: slug } = Route.useParams();
  const { data } = useSuspenseQuery(planQueryOptions(slug));
  const queryClient = useQueryClient();

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

  const saveMutation = useMutation({
    mutationFn: (markdown: string) =>
      apiFetch(`/api/plans/${encodeURIComponent(slug)}`, PlanSaveResponse, {
        method: "PUT",
        headers: { "Content-Type": "text/plain" },
        body: markdown,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["plans"] });
      void queryClient.invalidateQueries({ queryKey: ["plans", slug] });
    },
  });

  const handleSave = useCallback(async () => {
    setFeedback(null);
    try {
      await saveMutation.mutateAsync(draftRef.current);
      setFeedback("Saved");
    } catch {
      setFeedback("Failed to save");
    }
  }, [saveMutation]);

  const handlePreview = useCallback(async () => {
    try {
      await saveMutation.mutateAsync(draftRef.current);
      void navigate({ to: "/plan/$filename", params: { filename: slug } });
    } catch {
      setFeedback("Failed to save");
    }
  }, [saveMutation, navigate, slug]);

  if (!data) {
    return (
      <div>
        <Link to="/plans" className="text-sm text-accent-100 hover:underline">
          &larr; All Plans
        </Link>
        <h1 className="mt-4 text-lg font-semibold">Plan Not Found</h1>
      </div>
    );
  }

  const saving = saveMutation.isPending;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <Link to="/plans" className="text-sm text-accent-100 hover:underline">
          &larr; All Plans
        </Link>
        <button
          type="button"
          onClick={handlePreview}
          className="text-sm text-accent-100 hover:underline"
        >
          Preview
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded bg-accent-100 px-3 py-1 text-sm text-on-primary hover:bg-accent-100/90 disabled:opacity-50"
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
      <Suspense fallback={<div className="text-t6 text-sm">Loading editor...</div>}>
        <MarkdownEditor key={initialMarkdown} markdown={initialMarkdown} onChange={handleChange} />
      </Suspense>
    </div>
  );
}
