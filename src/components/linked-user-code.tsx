import {useCallback, useRef} from "react";

import {
	DISABLED_REASON_ATTR,
	DISABLED_REASON_WRAPPER_ATTR,
	FILE_REF_BLOCK_REASONS,
	fileRefReasonId,
} from "../lib/file-refs";
import {useUserCodeFileRef} from "./use-file-ref-link";
import {BLOCKED_WRAPPER_CLASS, USER_CODE_CLASS, USER_LINK_CLASS} from "./user-code-classes";
import {PlainUserCode} from "./plain-user-code";
import {useFocusSlot} from "./use-focus-slot";
import {useReasonTooltip} from "./use-reason-tooltip";

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
	const reasonTooltip = useReasonTooltip();
	const {ref, buttonProps} = useUserCodeFileRef(text);
	const block = ref?.block;

	if (ref === undefined) return <PlainUserCode text={text} />;
	if (block !== undefined) {
		const id = fileRefReasonId(ref.path, block);
		return (
			<bdi key="blocked" dir="ltr">
				<span
					// oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- upstream's disabled-reason wrapper is a tab stop that reaches its reason tooltip
					tabIndex={0}
					{...{[DISABLED_REASON_WRAPPER_ATTR]: ""}}
					aria-describedby={id}
					className={BLOCKED_WRAPPER_CLASS}
					{...reasonTooltip.handlers}
				>
					<code className={USER_CODE_CLASS}>{text}</code>
					{block === "missing" && <span ref={focusSlot} hidden />}
					<span id={id} hidden {...{[DISABLED_REASON_ATTR]: ""}}>
						{FILE_REF_BLOCK_REASONS[block]}
					</span>
				</span>
				{reasonTooltip.tooltip}
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
