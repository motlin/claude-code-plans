const MAX_PRECEDING_INDICES = 50;
const HIGHLIGHT_DURATION_MS = 2_000;

export function jumpToMessage(lineArrayIndex: number): boolean {
  for (let offset = 0; offset <= MAX_PRECEDING_INDICES; offset += 1) {
    const candidateIndex = lineArrayIndex - offset;
    if (candidateIndex < 0) break;

    const element = document.getElementById(`msg-${candidateIndex}`);
    if (!element) continue;

    element.scrollIntoView({ block: "center", behavior: "smooth" });
    element.classList.add("message-highlight");
    setTimeout(() => element.classList.remove("message-highlight"), HIGHLIGHT_DURATION_MS);
    return true;
  }

  return false;
}
