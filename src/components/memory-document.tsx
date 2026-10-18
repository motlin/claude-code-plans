import {parseMemoryFrontmatter} from "../lib/memory-frontmatter";
import {MarkdownView} from "./markdown-view";

/** A memory file: frontmatter `name` as the h1, `description` muted beneath, then the body. */
export function MemoryDocument({markdown, mdLinkBase}: {markdown: string; mdLinkBase?: string | undefined}) {
	const {name, description, body} = parseMemoryFrontmatter(markdown);
	return (
		<>
			{name !== undefined && <h1 className="text-lg font-semibold break-words">{name}</h1>}
			{description !== undefined && <p className="mt-1 text-sm text-t6">{description}</p>}
			<div className={name !== undefined || description !== undefined ? "mt-4" : undefined}>
				<MarkdownView markdown={body} mdLinkBase={mdLinkBase} />
			</div>
		</>
	);
}
