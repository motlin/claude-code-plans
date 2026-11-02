import {Component, type ReactNode} from "react";

/* Upstream `MK`: errors landing over the fallback more often than this give up and render nothing. */
const MAX_ERROR_RECOMMITS = 3;

export interface RenderErrorBoundaryState
{
	error: unknown;
	fallbackFailed: boolean;
	resetCount: number;
}

export interface RenderErrorBoundaryProps
{
	/** A change here (a later tool stage, new row data) clears a caught error and redraws the children. */
	resetOn: unknown;
	/** The crash fallback; a function gets the error and a `reset` that redraws the children. */
	fallback: ReactNode | ((error: unknown, reset: () => void) => ReactNode);
	/** Logs a crash; called once per `resetOn` value unless `reportEveryCatch`. */
	report: (error: unknown) => void;
	/** Upstream's TranscriptRow subclass clears `hasCaptured` on every catch and dedupes in `report`. */
	reportEveryCatch?: boolean;
	onError?: (error: unknown) => void;
	children: ReactNode;
}

/**
 * Upstream's base render boundary (`yW`): it resets only when `resetOn` changes, reports once per
 * `resetOn`, and renders nothing once errors keep landing over its own fallback. It never rethrows by
 * itself; a fallback function may throw to escalate past it.
 */
export class RenderErrorBoundary extends Component<RenderErrorBoundaryProps, RenderErrorBoundaryState>
{
	override state: RenderErrorBoundaryState =
	{
		error: null,
		fallbackFailed: false,
		resetCount: 0,
	};
	private hasCaptured = false;
	private committedState: RenderErrorBoundaryState | null = null;
	private errorRecommits = 0;

	static getDerivedStateFromError(error: unknown): Partial<RenderErrorBoundaryState>
	{
		return {
			error,
		};
	}

	override componentDidMount()
	{
		this.committedState = this.state;
	}

	override componentDidUpdate(
		prevProps:
		{
			resetOn: unknown;
		},
		prevState: RenderErrorBoundaryState,
	)
	{
		if (!this.state.fallbackFailed && this.capturedOverFallback(prevState))
		{
			this.errorRecommits += 1;
			if (this.errorRecommits > MAX_ERROR_RECOMMITS && this.state.error !== null)
			{
				// oxlint-disable-next-line react/no-did-update-set-state -- upstream `yW` gives up on a failing fallback here, after the commit that counted it
				this.setState(
					{
						fallbackFailed: true,
					},
				);
			}
		}
		this.committedState = this.state;
		if (prevProps.resetOn !== this.props.resetOn)
		{
			this.hasCaptured = false;
			if (this.state.error !== null) this.reset();
		}
	}

	override componentDidCatch(error: unknown)
	{
		this.props.onError?.(error);
		if (this.props.reportEveryCatch === true) this.hasCaptured = false;
		if (this.hasCaptured) return;
		this.hasCaptured = true;
		this.props.report(error);
	}

	private readonly reset = () =>
	{
		this.errorRecommits = 0;
		this.setState((state) => (
		{
			error: null,
			fallbackFailed: false,
			resetCount: state.resetCount + 1,
		}));
	};

	private capturedOverFallback(previous: RenderErrorBoundaryState): boolean
	{
		return (
			previous !== this.state &&
			previous.error !== null &&
			this.state.error !== null &&
			previous.resetCount === this.state.resetCount
		);
	}

	override render(): ReactNode
	{
		const {error, fallbackFailed} = this.state;
		if (error === null) return this.props.children;
		const pending = this.committedState !== null && this.capturedOverFallback(this.committedState) ? 1 : 0;
		if (fallbackFailed || this.errorRecommits + pending > MAX_ERROR_RECOMMITS) return null;
		const {fallback} = this.props;
		return typeof fallback === "function" ? fallback(error, this.reset) : fallback;
	}
}
