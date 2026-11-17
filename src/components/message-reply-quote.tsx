/** Upstream's bubble reply quote (`BE`): the quoted text a reply-card prompt answers, drawn inside the user bubble. */
export function MessageReplyQuote({text}: {text: string})
{
	return (
		<blockquote
			data-find-omitted=""
			data-reply-quote-block=""
			dir="auto"
			className="min-w-0 border-s-2 border-strong ps-sm text-body text-muted-as-secondary whitespace-pre-wrap [overflow-wrap:anywhere]"
		>
			{text}
		</blockquote>
	);
}
