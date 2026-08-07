import { readFile } from "node:fs/promises";
import { extractTitleFromContent, humanizeFilename } from "./markdown-utils.js";

export { extractTitleFromContent, humanizeFilename } from "./markdown-utils.js";

export async function extractTitle(filePath: string, filename: string): Promise<string> {
  try {
    const content = await readFile(filePath, "utf-8");
    return extractTitleFromContent(content, filename);
  } catch {
    return humanizeFilename(filename);
  }
}
