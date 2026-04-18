import {ExternalLink} from 'lucide-react';
import {useDebug} from './debug-provider';

type DebugLinkProps =
	| {
			sessionId: string;
			uuid: string | undefined;
			className?: string;
	  }
	| {
			kind: 'plan' | 'memory' | 'task' | 'command';
			relativePath: string;
			label?: string;
			className?: string;
	  };

export function DebugLink(props: DebugLinkProps) {
	const {enabled} = useDebug();
	const className = props.className ?? '';

	if (!enabled) return null;

	let href: string;
	let title: string;
	if ('sessionId' in props) {
		if (!props.uuid) return null;
		href = `/session/${props.sessionId}/source/${props.uuid}`;
		title = `View source JSONL for ${props.uuid.slice(0, 8)}`;
	} else {
		const segments = props.relativePath.split('/').map(encodeURIComponent).join('/');
		href = `/source/${props.kind}/${segments}`;
		title = props.label ?? `View source ${props.kind} (${props.relativePath})`;
	}

	return (
		<a
			href={href}
			target="_blank"
			rel="noopener noreferrer"
			title={title}
			onClick={(e) => e.stopPropagation()}
			className={`inline-flex items-center justify-center text-text-500 hover:text-text-100 transition-colors ${className}`}
		>
			<ExternalLink className="h-3 w-3" />
		</a>
	);
}
