import {ExternalLink} from 'lucide-react';
import {useDebug} from './debug-provider';

export function DebugLink({
	sessionId,
	uuid,
	className = '',
}: {
	sessionId: string;
	uuid: string | undefined;
	className?: string;
}) {
	const {enabled} = useDebug();
	if (!enabled || !uuid) return null;

	return (
		<a
			href={`/session/${sessionId}/source/${uuid}`}
			target="_blank"
			rel="noopener noreferrer"
			title={`View source JSONL for ${uuid.slice(0, 8)}`}
			onClick={(e) => e.stopPropagation()}
			className={`inline-flex items-center justify-center text-text-500 hover:text-text-100 transition-colors ${className}`}
		>
			<ExternalLink className="h-3 w-3" />
		</a>
	);
}
