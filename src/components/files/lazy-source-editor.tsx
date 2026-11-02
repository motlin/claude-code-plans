// fallow-ignore-file unused-file -- files-viewer-codemirror-readonly T3 mounts this in the Files source view
import {lazy} from "react";

/** Keeps CodeMirror out of the cold bundles; it loads only where the source view renders. */
export const LazySourceEditor = lazy(async () =>
	import("./source-editor").then((module) => (
	{
		default: module.SourceEditor,
	})),
);
