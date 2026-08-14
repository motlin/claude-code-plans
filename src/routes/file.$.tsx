import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { FileViewer } from "../components/file-viewer";
import { decodeFilePath, fileViewerQueryOptions } from "../lib/api/file";

export const Route = createFileRoute("/file/$")({
  component: FileViewerPage,
  loader: ({ context: { queryClient }, params }) =>
    queryClient.ensureQueryData(fileViewerQueryOptions(params._splat ?? "")),
  head: ({ params }) => {
    const path = decodeFilePath(params._splat ?? "");
    const filename = path?.split("/").at(-1) ?? "Invalid path";
    return { meta: [{ title: `File: ${filename}` }] };
  },
});

function FileViewerPage() {
  const { _splat: pathToken = "" } = Route.useParams();
  const { data } = useSuspenseQuery(fileViewerQueryOptions(pathToken));

  return (
    <main className="mx-auto max-w-[min(100%,96rem)] p-6">
      <header className="mb-4">
        <h1 className="text-lg font-medium text-primary">Read-only file</h1>
        <p className="mt-1 break-all font-mono text-xs text-t6">{data.path}</p>
      </header>
      <FileViewer file={data} />
    </main>
  );
}
