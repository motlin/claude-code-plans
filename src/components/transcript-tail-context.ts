import {createContext, type ReactNode} from "react";

/**
 * What closes the transcript inside its last assistant row: the working line, which upstream nests
 * in the last AssistantMessage column under the reply. Null when something follows the transcript.
 */
export const TranscriptTailContext = createContext<ReactNode>(null);
