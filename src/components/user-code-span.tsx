import {lazy, Suspense, useContext} from "react";

import {parseFileRefText} from "../lib/file-refs";
import {FileRefsContext} from "./file-refs-context";
import {PlainUserCode} from "./plain-user-code";

const LinkedUserCode = lazy(async () =>
	import("./linked-user-code").then((module) => (
	{
		default: module.LinkedUserCode,
	})),
);

/**
 * Upstream `U` (c8a6d9da5): a user-row code span, isolated left-to-right. A
 * path-shaped span inside a file-refs provider becomes the shared transcript
 * file link drawn as an underlined code chip; a nonInteractive (pending) row,
 * or a span naming no file, stays plain code.
 */
export function UserCodeSpan({text, nonInteractive = false}: {text: string; nonInteractive?: boolean})
{
	const context = useContext(FileRefsContext);
	if (nonInteractive || context === null || parseFileRefText(text) === null) return <PlainUserCode text={text} />;
	return (
		<Suspense fallback={<PlainUserCode text={text} />}>
			<LinkedUserCode text={text} />
		</Suspense>
	);
}
