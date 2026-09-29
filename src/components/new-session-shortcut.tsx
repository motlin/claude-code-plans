import { useNavigate } from "@tanstack/react-router";
import { useShortcut } from "../hooks/use-shortcut";
import { requestHomeComposerFocus } from "../lib/home-composer-focus";

/** ⇧⌘O "New session": go home and focus the composer, like claude.ai/code. */
export function NewSessionShortcut() {
  const navigate = useNavigate();
  useShortcut("new_session", () => {
    void navigate({ to: "/" }).then(requestHomeComposerFocus);
  });
  return null;
}
