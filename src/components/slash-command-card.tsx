/*
 * The slash-command hover card's body, shared by the transcript chip and the composer's skill chip. It lives apart from
 * slash-command-chip.tsx so the composer does not pull UserPlainText (and its link, secret and file-ref policies) onto Home.
 */

export const SLASH_COMMAND_CARD_CLASS =
	"flex w-[280px] max-w-[calc(100vw-16px)] flex-col gap-1 rounded-r7 bg-[var(--menu-bg)] p-3 text-[13px]/[19px] text-primary shadow-[var(--menu-shadow)] outline-none";

const CARD_DESCRIPTION_CLASS =
	"max-h-[min(40vh,calc(var(--available-height,100vh)-3rem))] scroll-fade-y overflow-y-auto overscroll-contain break-words text-primary";

/**
 * Upstream's shared hover-card content (`ln`): a muted `/name` line, then the description when
 * there is one. An unknown command (`description` undefined) gets a "No preview available" footnote.
 */
export function SlashCommandCardBody({name, description}: {name: string; description: string | undefined})
{
	if (description === undefined)
	{
		return <span className="text-[12px]/[16px] text-ink-muted">No preview available</span>;
	}
	return (
		<>
			<span data-slash-command-card-name="" className="truncate text-ink-muted">{`/${name}`}</span>
			{description !== "" && (
				<span data-slash-command-card-description="" className={CARD_DESCRIPTION_CLASS}>
					{description}
				</span>
			)}
		</>
	);
}
