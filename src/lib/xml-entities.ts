/**
 * Decodes the three entities the CLI escapes in XML-tagged transcript text,
 * as upstream's `N` does: `&lt;`, then `&gt;`, then `&amp;` last, so
 * `&amp;gt;` becomes `&gt;`, not `>`.
 */
export function decodeXmlEntities(text: string): string
{
	return text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}
