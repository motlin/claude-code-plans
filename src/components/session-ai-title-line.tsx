import {secondaryAiTitle} from "../lib/ai-title";
import {useSettings} from "./settings-context";

/** The CLI's AI title to show beside `title`, or null when it matches or Show AI titles is off. */
export function useSecondaryAiTitle(title: string, aiTitle: string | null | undefined): string | null {
	const {settings} = useSettings();
	return settings.showAiTitles ? secondaryAiTitle(title, aiTitle) : null;
}

/** A muted line under the session titlebar naming the CLI's AI title when a /rename title replaced it. */
export function SessionAiTitleLine({title, aiTitle}: {title: string; aiTitle: string | null | undefined}) {
	const secondary = useSecondaryAiTitle(title, aiTitle);
	if (secondary === null) return null;
	return (
		<p
			data-session-ai-title
			title="AI-generated title"
			className="-mt-1 truncate pb-1 pl-8 text-[12px] leading-4 text-ink-muted"
		>
			{secondary}
		</p>
	);
}
