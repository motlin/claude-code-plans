import {useLayoutEffect, useRef} from "react";

import {DISABLED_REASON_WRAPPER_ATTR, FILE_REF_BLOCK_REASONS, fileRefReasonId} from "../lib/file-refs";
import {type CheckedOpenResult, useUserCodeFileRef} from "./use-file-ref-link";
import {BLOCKED_WRAPPER_CLASS, USER_CODE_CLASS, USER_LINK_CLASS} from "./user-code-classes";
import {PlainUserCode} from "./plain-user-code";
import {useReasonTooltip} from "./use-reason-tooltip";

/**
 * Upstream `Ir` for a user-row code span inside a file-refs provider: plain
 * code until the path resolves, then the underlined code-chip link, or the
 * disabled-reason wrapper once it is blocked (outside the roots, or missing).
 */
export function LinkedUserCode({text}: {text: string}) {
	const link = useRef<HTMLSpanElement>(null);
	const wrapper = useRef<HTMLSpanElement>(null);
	// Upstream's focus slot: a clicked ref found missing hands focus to its blocked wrapper.
	const focusOnBlock = useRef(false);
	const reasonTooltip = useReasonTooltip();
	const {ref, buttonProps} = useUserCodeFileRef(text, (result: Promise<CheckedOpenResult>) => {
		focusOnBlock.current = true;
		void result.then((outcome) => {
			if (outcome !== "missing") focusOnBlock.current = false;
		});
	});
	const block = ref?.block;
	useLayoutEffect(() => {
		if (block === undefined || !focusOnBlock.current || wrapper.current === null) return;
		focusOnBlock.current = false;
		const active = document.activeElement;
		if (active === null || active === document.body) wrapper.current.focus({preventScroll: true});
	}, [block]);

	if (ref === undefined) return <PlainUserCode text={text} />;
	if (block !== undefined) {
		const id = fileRefReasonId(ref.path, block);
		return (
			<bdi key="blocked" dir="ltr">
				<span
					ref={wrapper}
					// oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- upstream's disabled-reason wrapper is a tab stop that reaches its reason tooltip
					tabIndex={0}
					{...{[DISABLED_REASON_WRAPPER_ATTR]: ""}}
					aria-describedby={id}
					className={BLOCKED_WRAPPER_CLASS}
					{...reasonTooltip.handlers}
				>
					<code className={USER_CODE_CLASS}>{text}</code>
					<span id={id} hidden data-disabled-reason="">
						{FILE_REF_BLOCK_REASONS[block]}
					</span>
				</span>
				{reasonTooltip.tooltip}
			</bdi>
		);
	}
	return (
		<bdi key="link" dir="ltr">
			<span ref={link} {...buttonProps(() => link.current)} className={USER_LINK_CLASS}>
				{text}
			</span>
		</bdi>
	);
}
