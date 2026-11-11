import {useCallback, useRef} from "react";

import {BlockedFileRef} from "./blocked-file-ref";
import {useUserCodeFileRef} from "./use-file-ref-link";
import {USER_CODE_CLASS, USER_LINK_CLASS} from "./user-code-classes";
import {PlainUserCode} from "./plain-user-code";
import {useFocusSlot} from "./use-focus-slot";

/**
 * Upstream `Ir` for a user-row code span inside a file-refs provider: plain
 * code until the path resolves, then the underlined code-chip link, or the
 * disabled-reason wrapper once it is blocked (outside the roots, or missing).
 */
export function LinkedUserCode({text}: {text: string}) {
	const link = useRef<HTMLSpanElement | null>(null);
	// Upstream's focus slot: a focused link replaced by its missing wrapper hands focus to the wrapper.
	const focusSlot = useFocusSlot();
	const linkRef = useCallback(
		(node: HTMLSpanElement | null) => {
			link.current = node;
			focusSlot(node);
		},
		[focusSlot],
	);
	const {ref, buttonProps} = useUserCodeFileRef(text);
	const block = ref?.block;

	if (ref === undefined) return <PlainUserCode text={text} />;
	if (block !== undefined) {
		return (
			<bdi key="blocked" dir="ltr">
				<BlockedFileRef path={ref.path} block={block} focusSlot={focusSlot}>
					<code className={USER_CODE_CLASS}>{text}</code>
				</BlockedFileRef>
			</bdi>
		);
	}
	return (
		<bdi key="link" dir="ltr">
			<span ref={linkRef} {...buttonProps(() => link.current)} className={USER_LINK_CLASS}>
				{text}
			</span>
		</bdi>
	);
}
