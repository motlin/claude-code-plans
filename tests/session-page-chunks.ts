import {preloadComposerSurfaces} from "../src/components/composer-surfaces-entry";
import {preloadFileTypeIcons} from "../src/components/file-type-icons-loader";
import {loadSessionPromptCards} from "../src/components/session-prompt-cards-entry";
import {preloadSideChatPanel} from "../src/components/side-chat-panel-module";

/**
 * Loads the chunks a mounted SessionPage starts fetching on its own (the composer kicks off its surfaces and the
 * file-type icon set on mount). Await it in beforeAll so no import resolves after the jsdom environment is torn down.
 */
export async function preloadSessionPageChunks(): Promise<void>
{
	await Promise.all([
		preloadComposerSurfaces(),
		preloadFileTypeIcons(),
		preloadSideChatPanel(),
		loadSessionPromptCards(),
	]);
}
