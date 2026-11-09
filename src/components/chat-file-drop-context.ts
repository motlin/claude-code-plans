import {createContext} from "react";

export type ChatFileDropHandler = (files: readonly File[]) => void;

/**
 * The session composer registers its attach here (returning the unregister); the chat tile's zone is disabled while
 * nothing is registered, as upstream's is when the session can't take attachments.
 */
export const ChatFileDropContext = createContext<((handler: ChatFileDropHandler) => () => void) | null>(null);
