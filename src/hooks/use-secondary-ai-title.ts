import {useSettings} from "../components/settings-context";
import {secondaryAiTitle} from "../lib/ai-title";

/** The CLI's AI title to show beside `title`, or null when it matches or Show AI titles is off. */
export function useSecondaryAiTitle(title: string, aiTitle: string | null | undefined): string | null {
	const {settings} = useSettings();
	return settings.showAiTitles ? secondaryAiTitle(title, aiTitle) : null;
}
