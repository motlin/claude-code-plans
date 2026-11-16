import {lazy} from "react";

/** Keeps CodeMirror out of the cold bundles; it loads only where the source view renders. */
export const LazySourceEditor = lazy(async () =>
	import("./source-editor").then((module) => (
	{
		default: module.SourceEditor,
	})),
);
