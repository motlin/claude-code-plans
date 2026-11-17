import {useEffect, useRef, useState} from "react";

import {useArchiveSessions} from "../../hooks/use-session-archive";
import {ConfirmDialog} from "../confirm-dialog";
import {Icon} from "../ui/icon";
import {Menu, MenuContent, MenuItem, MenuTrigger} from "../ui/menu";
import {useAfterMenuClose} from "./use-after-menu-close";

/** What a fetch-all drain reports: whether the feed ran out, and how to trim the pages it loaded. */
export interface FetchAllResult
{
	exhausted: boolean;
	release: () => void;
}

/**
 * Upstream `AG`'s trigger: a default-size (24px) ghost icon button hidden until the label row is
 * hovered or focused (60%), fully opaque while hovered, focused or open, and always shown on touch.
 */
const TRIGGER_CLASS =
	"df-chrome-btn df-touch-reveal -my-1 flex size-6 shrink-0 items-center justify-center rounded-r6 text-[color:var(--sb-heading-ink,var(--color-secondary))] hover:text-primary hover:bg-[var(--sb-hover)] opacity-0 group-hover/labelrow:opacity-60 group-focus-within/labelrow:opacity-60 hover:!opacity-100 focus-visible:!opacity-100 aria-expanded:!opacity-100 data-[popup-open]:!opacity-100 hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus";

const COUNTING = "Counting sessions older than a week…";
const TRUNCATED_SUFFIX = " Not all sessions could be loaded, so some older sessions will remain.";

function sessionsWord(count: number): string
{
	return count === 1 ? "session" : "sessions";
}

function confirmBody(count: number, truncated: boolean): string
{
	return `This will archive ${count} ${sessionsWord(count)} older than a week. Pinned sessions aren’t affected.${
		truncated ? TRUNCATED_SUFFIX : ""
	}`;
}

function archivedMessage(truncated: boolean): (count: number) => string
{
	return (count) =>
		`Archived ${count} older ${sessionsWord(count)}${
			truncated ? ". Sessions that haven’t loaded weren’t archived." : ""
		}`;
}

/**
 * Upstream `AG` (OlderBucketMenu): the Date "Older" header's bulk menu. Archive all pages in the rest
 * of the feed while its confirm counts, archives every older session that isn't pinned or open (8
 * requests at a time), then trims the feed back to the pages it had before. Archive-only: upstream's
 * Delete all has no local counterpart.
 */
export function OlderBucketMenu({
	ids,
	listHasMore,
	onFetchAll,
}: {
	/** The Older sessions Archive all would archive; grows as the drain lands pages. */
	ids: readonly string[];
	/** The feed has another page, so the count isn't known yet. */
	listHasMore: boolean;
	/** Pages in the rest of the feed; unset when there is nothing to fetch from. */
	onFetchAll?: (() => Promise<FetchAllResult>) | undefined;
})
{
	const archiveSessions = useArchiveSessions();
	const {later, menuProps, contentProps} = useAfterMenuClose();
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [counting, setCounting] = useState(false);
	const [truncated, setTruncated] = useState(false);
	const [archiving, setArchiving] = useState(false);
	const openRef = useRef(false);
	const epoch = useRef(0);
	const unmounted = useRef(false);
	const held = useRef<(() => void) | null>(null);

	const release = () =>
	{
		const pending = held.current;
		held.current = null;
		pending?.();
	};
	useEffect(() =>
	{
		unmounted.current = false;
		return () =>
		{
			unmounted.current = true;
			release();
		};
	}, []);

	const setOpen = (open: boolean) =>
	{
		openRef.current = open;
		setConfirmOpen(open);
	};

	const startArchiveAll = async () =>
	{
		setTruncated(false);
		setOpen(true);
		if (onFetchAll === undefined) return;
		const request = ++epoch.current;
		setCounting(true);
		try
		{
			const result = await onFetchAll();
			if (unmounted.current)
			{
				result.release();
				return;
			}
			held.current ??= result.release;
			if (request !== epoch.current) return;
			if (openRef.current)
			{
				setTruncated(!result.exhausted);
			}
			else
			{
				release();
			}
		}
		catch
		{
			if (request === epoch.current) setTruncated(true);
		}
		finally
		{
			if (request === epoch.current && !unmounted.current) setCounting(false);
		}
	};

	const onOpenChange = (open: boolean) =>
	{
		if (!open) release();
		setOpen(open);
	};

	const confirm = () =>
	{
		const scope = [...ids];
		const wasTruncated = truncated;
		// Trim first: each archive refetches the lists, which would otherwise reload every drained page.
		release();
		setArchiving(true);
		void archiveSessions(
			scope,
			{
				concurrency: 8,
				message: archivedMessage(wasTruncated),
				durationMs: wasTruncated ? 8000 : 3000,
				uniqueKey: "archive-older-bulk",
			},
		).finally(() =>
		{
			if (!unmounted.current) setArchiving(false);
		});
	};

	if (ids.length === 0 && !confirmOpen) return null;
	return (
		<>
			<Menu {...menuProps}>
				<MenuTrigger aria-label="Bulk actions for older sessions" className={TRIGGER_CLASS}>
					<Icon name="DotsHorizontal" customSize={16} className="size-4" />
				</MenuTrigger>
				<MenuContent align="end" {...contentProps}>
					{!archiving && ids.length > 0 && (
						<MenuItem onSelect={later(() => void startArchiveAll())}>
							{listHasMore ? "Archive all" : `Archive all (${ids.length})`}
						</MenuItem>
					)}
				</MenuContent>
			</Menu>
			<ConfirmDialog
				open={confirmOpen}
				onOpenChange={onOpenChange}
				title="Archive older sessions?"
				body={counting ? COUNTING : confirmBody(ids.length, truncated)}
				bodyLive
				confirmLabel="Archive all"
				confirmDisabled={counting || ids.length === 0}
				onConfirm={confirm}
			/>
		</>
	);
}
