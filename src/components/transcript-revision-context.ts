import {createContext} from "react";

/**
 * The session's transcript length, so every mounted Usage card refetches its stats as the session runs (upstream's
 * card reads the live bucket) while the transcript's card renderer stays stable. Kept apart from the lazily loaded card.
 */
export const TranscriptRevisionContext = createContext(0);
