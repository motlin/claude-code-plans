/*
 * Upstream's "Claude Code notice" row (renderer c01e7498d `d_` row, `p_` body, `l_` line): one or more
 * adjacent `system/informational` records drawn as a disclosure. Warnings start open, notices collapsed,
 * and the verbose transcript forces it open. Artifact URLs inside a message stay plain text until the
 * artifact-mark-primitive feature lands (upstream draws them as artifact link chips).
 */
import {useState} from "react";

import {hookNoticeText} from "../lib/hook-notice-copy";
import type {HookNotice} from "../lib/transcript";
import {Icon} from "./ui/icon";

function WarningIcon() {
	return <Icon name="Warning" size="sm" className="shrink-0 text-danger" alt="Warning" />;
}

export function HookNoticeLine({notice, markWarning}: {notice: HookNotice; markWarning: boolean}) {
	return (
		<div className="flex items-start gap-1 select-text">
			{markWarning && notice.level === "warning" && (
				<span className="text-body flex h-[1lh] shrink-0 items-center">
					<WarningIcon />
				</span>
			)}
			<span className="min-w-0 text-body text-secondary whitespace-pre-wrap [overflow-wrap:anywhere]">
				{hookNoticeText(notice.message)}
			</span>
		</div>
	);
}

export function HookNoticeRow({notices, verbose}: {notices: readonly HookNotice[]; verbose: boolean}) {
	const hasWarning = notices.some((notice) => notice.level === "warning");
	// A toggle only holds while the warning state it was made under does (upstream `hadWarning`).
	const [toggle, setToggle] = useState<{expanded: boolean; hadWarning: boolean}>();
	const expanded = verbose || (toggle?.hadWarning === hasWarning ? toggle.expanded : hasWarning);
	// Upstream's expanding body renders nothing until first opened, then stays mounted and hidden.
	const [mounted, setMounted] = useState(false);
	if (expanded && !mounted) setMounted(true);
	const label = notices.length === 1 ? "Claude Code notice" : `${notices.length} Claude Code notices`;
	return (
		<div
			data-hook-notice=""
			data-find-omitted=""
			className="flex w-full flex-col ps-[var(--cds-assistant-message-text-inset,0px)]"
		>
			<button
				type="button"
				aria-expanded={expanded}
				onClick={() => {
					if (!verbose) setToggle({expanded: !expanded, hadWarning: hasWarning});
				}}
				className="relative group/tool flex self-start max-w-full items-center py-0 gap-1 text-start focus-visible:outline-hidden hide-focus-ring focus-visible:shadow-focus rounded-sm"
			>
				{hasWarning && <WarningIcon />}
				<span className="min-w-0 truncate text-body text-secondary group-hover/tool:text-primary">{label}</span>
				<span className="shrink-0 text-secondary group-hover/tool:text-primary">
					{/* Upstream's duration-fast is the local duration-[60ms] (ui/collapsible-classes.ts). */}
					<Icon
						name="CaretRightFilled"
						customSize={14}
						rotate={expanded ? 90 : 0}
						className="transition-transform duration-[60ms] motion-reduce:transition-none"
					/>
				</span>
			</button>
			{(expanded || mounted) && (
				<div
					className={expanded ? "epitaxy-expanding-body flow-root" : "epitaxy-expanding-body"}
					hidden={!expanded}
				>
					<div className="flex flex-col gap-1 ps-p6 comfortable:ps-p8 pt-p3 comfortable:pt-p5">
						{notices.map((notice, index) => (
							<HookNoticeLine
								key={notice.uuid ?? index}
								notice={notice}
								markWarning={notices.length > 1}
							/>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
