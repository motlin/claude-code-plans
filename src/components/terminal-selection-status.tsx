export function TerminalSelectionStatus({announcement}: {announcement: string}) {
	return (
		<p role="status" className="sr-only">
			{announcement}
		</p>
	);
}
