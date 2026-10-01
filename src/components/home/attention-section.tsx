import {ChevronRight, X} from "lucide-react";
import {useId, useLayoutEffect, useRef, useState} from "react";

import type {HomeAttentionItem, HomeAttentionKind, HomeAttentionRow} from "../../lib/home-attention";
import {formatNarrowRelativeTime} from "../../lib/relative-time";
import {homeAttentionKindLabels} from "../../lib/schema-choices";
import {SessionHoverCard} from "../session-hover-card";
import {Tooltip} from "../ui/tooltip";

/** Upstream caps the Sessions section at five rows even on the tallest viewports. */
const MAX_SESSION_ROWS = 5;

const PILL_CLASSES = {
	blocked: {dot: "bg-[var(--status-dot-awaiting)]", label: "text-warning-000"},
	review: {dot: "bg-accent-100", label: "text-accent-100"},
} as const satisfies Record<HomeAttentionKind, {dot: string; label: string}>;

const HEADING = Symbol("heading");
type FocusTarget = string | typeof HEADING;

interface AttentionSectionProps<Row extends HomeAttentionRow> {
	items: readonly HomeAttentionItem<Row>[];
	/** From useViewportRowLimit(); capped at five here. */
	rowLimit: number;
	now: number;
	onOpen: (sessionId: string) => void;
	onDismiss: (item: HomeAttentionItem<Row>) => void;
}

/**
 * The home action center's "Sessions" section, in claude.ai/code's markup: Needs input and
 * Ready for review rows, capped with "Show N more", each dismissible until newer activity.
 */
export function AttentionSection<Row extends HomeAttentionRow>({
	items,
	rowLimit,
	now,
	onOpen,
	onDismiss,
}: Readonly<AttentionSectionProps<Row>>) {
	const headingId = useId();
	const [expanded, setExpanded] = useState(false);
	const headingRef = useRef<HTMLHeadingElement>(null);
	const listRef = useRef<HTMLUListElement>(null);
	const pendingFocus = useRef<FocusTarget | null>(null);

	useLayoutEffect(() => {
		const target = pendingFocus.current;
		if (target === null) return;
		pendingFocus.current = null;
		if (target === HEADING) {
			headingRef.current?.focus();
			return;
		}
		const next = listRef.current?.querySelector<HTMLButtonElement>(
			`li[data-session-id="${CSS.escape(target)}"] [data-row-dismiss]`,
		);
		if (next) next.focus();
		else headingRef.current?.focus();
	}, [items]);

	if (items.length === 0) return null;

	const limit = Math.min(rowLimit, MAX_SESSION_ROWS);
	const hiddenCount = Math.max(0, items.length - limit);
	const visible = expanded ? items : items.slice(0, limit);

	const dismiss = (index: number) => {
		const item = items[index];
		if (item === undefined) return;
		pendingFocus.current = items[index + 1]?.session.sessionId ?? HEADING;
		onDismiss(item);
	};

	return (
		<section aria-labelledby={headingId} className="flex flex-col gap-2">
			<header className="flex items-center gap-1">
				<h2
					id={headingId}
					ref={headingRef}
					tabIndex={-1}
					className="rounded-sm text-[13px] leading-[19px] font-normal text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-100"
				>
					Sessions
				</h2>
				<span className="flex-1" />
				{hiddenCount > 0 && (
					<button
						type="button"
						aria-expanded={expanded}
						onClick={() => setExpanded((previous) => !previous)}
						className="h-6 rounded-md px-1.5 text-[12px] leading-[15px] text-ink-muted hover:bg-fill-ghost-hover hover:text-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-100"
					>
						{expanded ? "Show less" : `Show ${hiddenCount} more`}
					</button>
				)}
			</header>
			<ul ref={listRef} role="list" className="flex flex-col gap-1">
				{visible.map((item, index) => (
					<AttentionRow
						key={item.session.sessionId}
						item={item}
						now={now}
						onOpen={onOpen}
						onDismiss={() => dismiss(index)}
					/>
				))}
			</ul>
		</section>
	);
}

function AttentionRow<Row extends HomeAttentionRow>({
	item,
	now,
	onOpen,
	onDismiss,
}: Readonly<{
	item: HomeAttentionItem<Row>;
	now: number;
	onOpen: (sessionId: string) => void;
	onDismiss: () => void;
}>) {
	const {session, kind, statusLine} = item;
	const title = session.title.trim() || "Untitled session";
	const pill = PILL_CLASSES[kind];

	return (
		<SessionHoverCard
			sessionId={session.sessionId}
			title={title}
			summary={session.summary}
			blocked={kind === "blocked"}
			onOpen={onOpen}
			side="bottom"
			align="end"
			render={
				<li
					data-session-id={session.sessionId}
					data-kind={kind}
					className="group flex h-10 items-center gap-2 rounded-lg bg-alpha-1 px-[5px] py-2 hover:bg-alpha-2 focus-within:bg-alpha-2"
				/>
			}
		>
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<button
					type="button"
					data-row-main-button
					aria-label={`Open session ${title}`}
					onClick={() => onOpen(session.sessionId)}
					className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-100"
				>
					<span className="flex min-w-0 flex-1 items-center gap-2">
						<span className="flex shrink-0 items-center">
							<span className="inline-flex w-4 items-center justify-center">
								<span data-pill-dot className={`size-[5px] rounded-full ${pill.dot}`} />
							</span>
							<span className="flex items-baseline gap-1">
								<span
									data-pill-label
									className={`whitespace-nowrap text-[12px] leading-[15px] ${pill.label}`}
								>
									{homeAttentionKindLabels[kind]}
								</span>
							</span>
						</span>
						<span className="flex min-w-0 flex-1 items-baseline gap-[5px]">
							<span data-row-title className="min-w-0 truncate text-[13px] leading-[19px] text-primary">
								{title}
							</span>
							{statusLine !== null && (
								<span
									data-row-status
									className="min-w-0 shrink-[9999] truncate text-[13px] leading-[19px] text-ink-muted"
								>
									{statusLine}
								</span>
							)}
						</span>
					</span>
					<span className="flex shrink-0 items-center gap-1">
						{session.project !== null && (
							<span
								data-row-project
								className="max-w-[180px] truncate text-[12px] leading-[15px] text-ink-muted"
							>
								{session.project}
							</span>
						)}
						<span className="-mr-1 min-w-5 text-center text-[12px] leading-[15px] text-ink-muted tabular-nums">
							<time dateTime={new Date(session.lastActivityAt).toISOString()}>
								{formatNarrowRelativeTime(session.lastActivityAt, now)}
							</time>
						</span>
						<ChevronRight aria-hidden="true" className="size-5 text-ink-muted group-hover:text-secondary" />
					</span>
				</button>
			</div>
			<Tooltip content="Dismiss" className="shrink-0">
				<button
					type="button"
					data-row-dismiss
					aria-label="Dismiss session"
					onClick={onDismiss}
					className="flex size-6 shrink-0 items-center justify-center rounded-md text-ink-muted opacity-0 hover:bg-fill-ghost-hover hover:text-primary group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-100"
				>
					<X aria-hidden="true" className="size-4" />
				</button>
			</Tooltip>
		</SessionHoverCard>
	);
}
