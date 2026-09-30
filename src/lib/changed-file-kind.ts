import {z} from "zod";

/**
 * Changed-file kinds for the Changes pane's "Separate test, build, and generated files" grouping,
 * in section order: source files first, then upstream's trailing sections.
 */
export const CHANGED_FILE_KINDS = ["source", "test", "build", "generated"] as const;

export const ChangedFileKindSchema = z.enum(CHANGED_FILE_KINDS);

export type ChangedFileKind = z.infer<typeof ChangedFileKindSchema>;
