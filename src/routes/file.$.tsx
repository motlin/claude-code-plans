import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { FileView } from "../components/files/file-view";
import { decodeFilePath, encodeFilePath, fileViewQueryOptions } from "../lib/api/file";
import { imageContentType } from "../lib/file-preview";

export const Route = createFileRoute("/file/$")({
  component: FileViewerPage,
  loader: async ({ context: { queryClient }, params }) => {
    const path = decodeFilePath(params._splat ?? "");
    if (path !== null && imageContentType(path) === null) {
      await queryClient.prefetchQuery(fileViewQueryOptions(path));
    }
  },
  head: ({ params }) => {
    const path = decodeFilePath(params._splat ?? "");
    const filename = path?.split("/").at(-1) ?? "Invalid path";
    return { meta: [{ title: `File: ${filename}` }] };
  },
});

function FileViewerPage() {
  const { _splat: pathToken = "" } = Route.useParams();
  const navigate = useNavigate();
  const path = decodeFilePath(pathToken);

  if (path === null) {
    return (
      <main className="p-6 text-body text-primary">A valid encoded file path is required.</main>
    );
  }
  return (
    <main className="mx-auto flex h-full max-w-[min(100%,96rem)] flex-col p-3">
      <FileView
        key={path}
        path={path}
        hashNavigation
        onOpenFile={(sibling) =>
          void navigate({ to: "/file/$", params: { _splat: encodeFilePath(sibling) } })
        }
      />
    </main>
  );
}
