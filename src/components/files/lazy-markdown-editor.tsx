import {lazy} from "react";

export const LazyMarkdownEditor = lazy(async () =>
	import("../markdown-editor").then((module) => ({default: module.MarkdownEditor})),
);
