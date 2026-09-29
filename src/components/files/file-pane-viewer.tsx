import { useQuery } from "@tanstack/react-query";
import { FileX } from "lucide-react";

import { ApiResponseError } from "../../lib/api/client";
import { encodeFilePath, fileViewerQueryOptions } from "../../lib/api/file";
import { FileViewer } from "../file-viewer";

function viewerErrorTitle(error: unknown): string {
  if (error instanceof ApiResponseError && error.status === 404) return "Couldn’t find this file";
  return "Can’t read this file";
}

function ViewerMessage({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-4 py-4 text-center">
      <FileX aria-hidden="true" className="size-7 text-t6" />
      <div className="flex flex-col items-center gap-1">
        <p className="max-w-[36ch] text-pretty break-words text-body text-primary">{title}</p>
        {detail !== undefined && (
          <p className="max-w-[36ch] text-pretty break-all text-footnote text-t6">{detail}</p>
        )}
      </div>
    </div>
  );
}

/** The Files pane viewer column for one absolute path, served by `/api/file`. */
export function FilePaneViewer({ path }: { path: string }) {
  const file = useQuery(fileViewerQueryOptions(encodeFilePath(path)));

  if (file.isPending) return <ViewerMessage title="Loading file" />;
  if (file.isError) return <ViewerMessage title={viewerErrorTitle(file.error)} detail={path} />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center px-3">
        <span
          dir="rtl"
          title={file.data.path}
          className="min-w-0 truncate text-left text-body text-secondary"
        >
          <bdi>{file.data.path}</bdi>
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
        <FileViewer file={file.data} />
      </div>
    </div>
  );
}
