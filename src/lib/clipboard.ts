/**
 * Write text to the clipboard with a legacy fallback for non-secure contexts.
 *
 * The modern `navigator.clipboard.writeText()` API requires a secure context
 * (HTTPS or localhost). When the app is served over plain HTTP on a LAN address,
 * this function falls back to the deprecated `document.execCommand('copy')` via
 * a temporary textarea element.
 *
 * Returns true if the copy succeeded, false otherwise.
 */
export async function writeClipboardText(text: string): Promise<boolean> {
  // Try the modern Clipboard API first
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to legacy approach
    }
  }

  // Legacy fallback using execCommand
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    // Position off-screen to avoid visual flash
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "-9999px";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const success = document.execCommand("copy");
    document.body.removeChild(textarea);
    return success;
  } catch {
    return false;
  }
}
