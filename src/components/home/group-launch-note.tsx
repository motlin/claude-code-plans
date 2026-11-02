/** Upstream's `Q5` strings. */
const WILL_BE_ADDED_BEFORE = "This session will be added to ";
const WILL_BE_ADDED_AFTER = " in the sidebar when you start it.";
const DONT_ADD = "Don’t add";

interface GroupLaunchNoteProps
{
	name: string;
	/** `line` takes the environment-bar line; `block` sits after the bar while a blocking line holds it. */
	placement: "line" | "block";
	onDismiss: () => void;
}

/**
 * Upstream's custom-group note (`e7`): the next home launch joins this sidebar group, with a "Don’t add" TextLink
 * (`inheritColor`) that clears the pending group.
 */
export function GroupLaunchNote({name, placement, onDismiss}: GroupLaunchNoteProps)
{
	if (placement === "block")
	{
		return (
			<p className="text-center text-balance text-footnote text-secondary">
				{WILL_BE_ADDED_BEFORE}
				<span className="font-medium text-primary">{name}</span>
				{WILL_BE_ADDED_AFTER}{" "}
				<DontAddLink name={name} onDismiss={onDismiss} className="cds-reset text-link-inherit" />
			</p>
		);
	}
	return (
		<span className="pointer-events-auto flex min-w-0 items-baseline gap-1 whitespace-nowrap">
			<span className="flex min-w-0 items-baseline overflow-hidden">
				<span className="shrink-0 whitespace-pre">{WILL_BE_ADDED_BEFORE}</span>
				<span className="flex min-w-0 font-medium text-primary">
					<span className="min-w-0 truncate">{name}</span>
				</span>
				<span className="shrink-0 whitespace-pre">{WILL_BE_ADDED_AFTER}</span>
			</span>
			<DontAddLink
				name={name}
				onDismiss={onDismiss}
				className="cds-reset text-link-inherit shrink-0 whitespace-nowrap"
			/>
		</span>
	);
}

function DontAddLink({name, onDismiss, className}: {name: string; onDismiss: () => void; className: string})
{
	return (
		<button
			type="button"
			data-cds="TextLink"
			aria-label={`Don’t add to ${name}`}
			onClick={onDismiss}
			className={className}
		>
			{DONT_ADD}
		</button>
	);
}
