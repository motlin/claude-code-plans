import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { AttachmentUploadResponse, MAX_ATTACHMENT_BYTES } from "./api/attachments";
import { getCacheDir } from "./db/connection";
import { rejectCrossSite } from "./same-origin-guard";

/** Image types Claude reads, by the extension their saved copy gets. */
const IMAGE_EXTENSIONS = new Map<string, string>([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/gif", "gif"],
  ["image/webp", "webp"],
]);

/** Room for the multipart envelope around a file at the size limit. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

function attachmentsDir(cacheDir: string = getCacheDir()): string {
  return join(cacheDir, "attachments");
}

function error(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

/** UTF-8 without NUL bytes: text whatever type the browser guessed from the extension. */
function isText(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

function textExtension(name: string): string {
  return /\.([A-Za-z0-9]{1,16})$/.exec(name)?.[1]?.toLowerCase() ?? "txt";
}

/**
 * `POST /api/attachments`: saves one same-origin multipart `file` (an image
 * Claude can read, or text, at most 5 MB) as `<uuid>.<ext>` under the cache
 * dir and returns its absolute path for the prompt.
 */
export async function handleAttachmentUpload(
  request: Request,
  dir: string = attachmentsDir(),
): Promise<Response> {
  const rejection = rejectCrossSite(request);
  if (rejection) return rejection;

  const declaredLength = Number(request.headers.get("Content-Length") ?? 0);
  if (declaredLength > MAX_ATTACHMENT_BYTES + MULTIPART_OVERHEAD_BYTES) {
    return error("File is larger than 5 MB", 413);
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return error("Expected a multipart `file`", 400);
  if (file.size > MAX_ATTACHMENT_BYTES) return error("File is larger than 5 MB", 413);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const imageExtension = IMAGE_EXTENSIONS.get(file.type);
  let extension: string;
  let mediaType: string;
  if (imageExtension !== undefined) {
    extension = imageExtension;
    mediaType = file.type;
  } else if (isText(bytes)) {
    extension = textExtension(file.name);
    mediaType = file.type.startsWith("text/") ? file.type : "text/plain";
  } else {
    return error("Only images (PNG, JPEG, GIF, WebP) and text files can be attached", 415);
  }

  await mkdir(dir, { recursive: true });
  const path = join(dir, `${randomUUID()}.${extension}`);
  await writeFile(path, bytes, { flag: "wx" });
  return Response.json(
    AttachmentUploadResponse.parse({ path, name: file.name, mediaType, size: file.size }),
    { status: 201 },
  );
}
