import { z } from "zod";
import { resolveUrl } from "./client";

/** Largest file `POST /api/attachments` accepts. */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

/** A file saved under `$XDG_CACHE_HOME/claude-code-plans/attachments`. */
export const AttachmentUploadResponse = z
  .object({
    /** Absolute path of the saved copy. */
    path: z.string(),
    /** The file's original name. */
    name: z.string(),
    mediaType: z.string(),
    size: z.number(),
  })
  .strict();
export type UploadedAttachment = z.infer<typeof AttachmentUploadResponse>;

const ErrorBody = z.object({ error: z.string() }).strict();

/** Uploads one file; rejects with the server's error message. */
export async function uploadAttachment(file: File): Promise<UploadedAttachment> {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(resolveUrl("/api/attachments"), {
    method: "POST",
    credentials: "same-origin",
    body: form,
  });
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = ErrorBody.safeParse(json);
    throw new Error(error.success ? error.data.error : `Upload failed (${response.status})`);
  }
  return AttachmentUploadResponse.parse(json);
}
