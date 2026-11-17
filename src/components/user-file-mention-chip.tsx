import {type ReactNode, useCallback, useContext, useRef} from "react";

import {BlockedFileRef} from "./blocked-file-ref";
import {FileRefsContext} from "./file-refs-context";
import {LazyFileTypeIcon} from "./lazy-file-type-icon";
import {Icon} from "./ui/icon";
import {useUserCodeFileRef} from "./use-file-ref-link";
import {useFocusSlot} from "./use-focus-slot";

/** Upstream `N` (c8a6d9da5): the chip's box, and the blocked wrapper's `blockedClassName`. */
const CHIP_BOX = "inline-block max-w-full leading-tight [baseline-source:first]";

/**
 * Upstream `F`: the shared link chip `te` (cb8c5a88f `cn` with `Fr`'s busy classes) merged with `${N} wrap-anywhere ps-1`,
 * with upstream's `bg-accent-muted`/`text-accent`/`bg-accent` mapped to the local upstream tokens.
 */
const MENTION_LINK_CHIP_CLASS =
	"inline-block aria-busy:cursor-progress aria-busy:opacity-60 epitaxy-link-chip items-center rounded-sm bg-upstream-accent-muted px-1.5 align-baseline text-upstream-accent no-underline hover:bg-upstream-accent-pressed data-[menu-open]:bg-upstream-accent-pressed focus-visible:outline-hidden hide-focus-ring focus-visible:shadow-focus max-w-full leading-tight [baseline-source:first] wrap-anywhere ps-1";

/** Upstream `I`: the text-primary chip (cb8c5a88f `pn`) merged with `${N} wrap-anywhere ps-1`, for a chip that can't open. */
const MENTION_FALLBACK_CHIP_CLASS =
	"epitaxy-link-chip items-center rounded-sm bg-upstream-accent-muted px-1.5 align-baseline text-primary no-underline inline-block max-w-full leading-tight [baseline-source:first] wrap-anywhere ps-1";

/** The cds disabled-reason wrapper's class (`Br`) merged with `blockedClassName` `N`. */
const MENTION_BLOCKED_WRAPPER_CLASS = `rounded-sm focus-visible:outline-hidden focus-visible:shadow-focus ${CHIP_BOX}`;

/** Upstream `L`: the glyph centred over the hidden `@`. */
const MENTION_ICON_CLASS = "absolute inset-y-0 start-1/2 my-auto -translate-x-1/2";

const ICON_STYLE =
{
	width: "16px",
	height: "16px",
};

interface UserFileMentionChipProps
{
	/** The mention as written, `@` first. */
	text: string;
	/** The path it names, without a leading `./` or a folder's trailing `/`. */
	target: string;
	folder: boolean;
	/** Upstream's `nonInteractive` (queued or pending prompts): the fallback chip, never a link. */
	nonInteractive: boolean;
}

/**
 * Upstream `R`'s content: the mention isolated left-to-right, its `@` kept in the DOM but invisible (so copy
 * keeps `@path`) with the file or folder glyph drawn over it.
 */
function MentionContent({text, target, folder}: {text: string; target: string; folder: boolean})
{
	return (
		<bdi dir="ltr">
			<span className="relative ms-0.25 me-1">
				{folder ? (
					<Icon name="Folder" size="sm" className={MENTION_ICON_CLASS} style={ICON_STYLE} />
				) : (
					<LazyFileTypeIcon fileName={target} size="sm" className={MENTION_ICON_CLASS} />
				)}
				<span className="opacity-0">{text[0]}</span>
			</span>
			{text.slice(1)}
		</bdi>
	);
}

function FallbackChip({children}: {children: ReactNode})
{
	return <span className={MENTION_FALLBACK_CHIP_CLASS}>{children}</span>;
}

/**
 * Upstream `Fr` around a file mention inside a file-refs provider: the fallback chip until the path resolves,
 * then the accent link chip (click and Enter/Space recheck existence, busy past 150ms; ⌘/Ctrl-click opens
 * the default app), or the fallback chip inside the disabled-reason wrapper once it is blocked.
 */
function LinkedMentionChip({refText, children}: {refText: string; children: ReactNode})
{
	const link = useRef<HTMLSpanElement | null>(null);
	const focusSlot = useFocusSlot();
	const linkRef = useCallback(
		(node: HTMLSpanElement | null) =>
		{
			link.current = node;
			focusSlot(node);
		},
		[focusSlot],
	);
	const {ref, buttonProps} = useUserCodeFileRef(refText);
	if (ref === undefined) return <FallbackChip>{children}</FallbackChip>;
	if (ref.block !== undefined)
	{
		return (
			<BlockedFileRef
				key="blocked"
				path={ref.path}
				block={ref.block}
				focusSlot={focusSlot}
				className={MENTION_BLOCKED_WRAPPER_CLASS}
			>
				<FallbackChip>{children}</FallbackChip>
			</BlockedFileRef>
		);
	}
	return (
		<span key="link" ref={linkRef} {...buttonProps(() => link.current)} className={MENTION_LINK_CHIP_CLASS}>
			{children}
		</span>
	);
}

/**
 * Upstream `R` (c8a6d9da5): an `@path` mention in a user's own prompt as a link chip with its file glyph. A
 * folder mention, a non-interactive row, or a prompt outside a file-refs provider draws the fallback chip.
 */
export function UserFileMentionChip({text, target, folder, nonInteractive}: UserFileMentionChipProps)
{
	const context = useContext(FileRefsContext);
	const content = <MentionContent text={text} target={target} folder={folder} />;
	if (nonInteractive || context === null || folder) return <FallbackChip>{content}</FallbackChip>;
	return <LinkedMentionChip refText={target.includes("/") ? target : `./${target}`}>{content}</LinkedMentionChip>;
}
