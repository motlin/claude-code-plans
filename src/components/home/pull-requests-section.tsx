import {ChevronRight} from "lucide-react";
import {useId, useState, type MouseEvent} from "react";

import type {HomePrRow, HomePrTone} from "../../lib/home-prs";
import {formatNarrowRelativeTime} from "../../lib/relative-time";

/** Upstream `dI` dot colors, as local `--color-git-*` tokens. */
const TONE_COLORS = {
	green: "var(--color-git-opened)",
	yellow: "var(--color-git-queued)",
	orange: "var(--color-git-conflicting)",
	red: "var(--color-diff-removed)",
	closed: "var(--color-git-closed)",
	neutral: "var(--color-alpha-3)",
} as const satisfies Record<HomePrTone, string>;

interface PullRequestsSectionProps {
	rows: readonly HomePrRow[];
	/** From useViewportRowLimit() (3–7). */
	rowLimit: number;
	now: number;
	onOpen: (sessionId: string) => void;
}

/**
 * The home action center's "Pull requests" section, in claude.ai/code's markup: one row per
 * active PR with its status pill; a click opens the session, ⌘/Ctrl-click opens the PR.
 */
export function PullRequestsSection({rows, rowLimit, now, onOpen}: Readonly<PullRequestsSectionProps>) {
	const headingId = useId();
	const [expanded, setExpanded] = useState(false);

	if (rows.length === 0) return null;

	const hiddenCount = Math.max(0, rows.length - rowLimit);
	const visible = expanded ? rows : rows.slice(0, rowLimit);

	return (
		<section aria-labelledby={headingId} className="flex flex-col gap-2">
			<header className="flex items-center gap-1">
				<h2 id={headingId} className="text-[13px] leading-[19px] font-normal text-primary">
					Pull requests
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
			<ul role="list" className="flex flex-col gap-1">
				{visible.map((row) => (
					<PullRequestRow key={row.url} row={row} now={now} onOpen={onOpen} />
				))}
			</ul>
		</section>
	);
}

function PullRequestRow({
	row,
	now,
	onOpen,
}: Readonly<{row: HomePrRow; now: number; onOpen: (sessionId: string) => void}>) {
	const onClick = (event: MouseEvent<HTMLButtonElement>) => {
		if (event.metaKey || event.ctrlKey) {
			window.open(row.url, "_blank", "noopener,noreferrer");
			return;
		}
		onOpen(row.sessionId);
	};

	return (
		<li
			data-pr-url={row.url}
			data-category={row.pill.category}
			className="group flex h-10 items-center gap-2 rounded-lg bg-alpha-1 px-[5px] py-2 hover:bg-alpha-2 focus-within:bg-alpha-2"
		>
			<button
				type="button"
				data-row-main-button
				aria-label={`Open session for ${row.title}`}
				title={`${row.url} (⌘-click to open the pull request)`}
				onClick={onClick}
				className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-100"
			>
				<span className="flex min-w-0 flex-1 items-center gap-2">
					<span className="flex shrink-0 items-center">
						<span className="inline-flex w-4 items-center justify-center">
							<span
								data-pill-dot
								className="size-[5px] rounded-full"
								style={{backgroundColor: TONE_COLORS[row.pill.tone]}}
							/>
						</span>
						<span data-pill-label className="whitespace-nowrap text-[12px] leading-[15px] text-secondary">
							{row.pill.label}
						</span>
					</span>
					<span className="flex min-w-0 flex-1 items-baseline gap-[5px]">
						<span data-row-title className="min-w-0 truncate text-[13px] leading-[19px] text-primary">
							{row.title}
						</span>
						<span
							data-row-number
							className="shrink-0 text-[13px] leading-[19px] text-ink-muted tabular-nums"
						>
							#{row.number}
						</span>
					</span>
				</span>
				<span className="flex shrink-0 items-center gap-1">
					{row.repo !== null && (
						<span
							data-row-repo
							className="max-w-[180px] truncate text-[12px] leading-[15px] text-ink-muted"
						>
							{row.repo}
						</span>
					)}
					<span className="-mr-1 min-w-5 text-center text-[12px] leading-[15px] text-ink-muted tabular-nums">
						<time dateTime={new Date(row.lastActivityAt).toISOString()}>
							{formatNarrowRelativeTime(row.lastActivityAt, now)}
						</time>
					</span>
					<ChevronRight aria-hidden="true" className="size-5 text-ink-muted group-hover:text-secondary" />
				</span>
			</button>
		</li>
	);
}
