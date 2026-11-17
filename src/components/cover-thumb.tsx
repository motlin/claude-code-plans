import {useEffect, useRef, useState, type ReactNode} from "react";

/** Upstream compares thumbnail URLs by origin and path, so a changed query alone keeps the shown img. */
function sameImage(url: string): string
{
	try
	{
		const parsed = new URL(url);
		return parsed.origin + parsed.pathname;
	}
	catch
	{
		return url;
	}
}

function preload(): HTMLImageElement
{
	const image = new Image();
	image.referrerPolicy = "no-referrer";
	return image;
}

/**
 * Upstream's thumbnail img with a fallback (`cd1653f2e` export `t`): a failing `src` first retries `fallbackSrc`
 * when it names another image, then renders `fallback` and reports `onError`; once a failed source preloads
 * again, the img comes back.
 */
export function CoverThumb({
	src,
	fallbackSrc,
	fallback,
	onError,
	onLoad,
	imgClassName = "h-full w-full object-cover",
	loading,
	fetchPriority,
}: {
	src: string;
	fallbackSrc?: string | undefined;
	fallback: ReactNode;
	onError?: (() => void) | undefined;
	onLoad?: ((which: "src" | "fallback") => void) | undefined;
	imgClassName?: string | undefined;
	loading?: "eager" | "lazy" | undefined;
	fetchPriority?: "high" | undefined;
})
{
	const [fellBackFor, setFellBackFor] = useState<string | null>(null);
	const failedPrimary = useRef<string | null>(null);
	const wanted = fallbackSrc !== undefined && fellBackFor === sameImage(src) ? fallbackSrc : src;
	const [shown, setShown] = useState(wanted);
	const [failed, setFailed] = useState<string | null>(null);
	const lastLoaded = useRef<string | null>(null);

	// Back on the primary once it loads again.
	useEffect(() =>
	{
		if (fallbackSrc === undefined || fellBackFor !== sameImage(src) || src === failedPrimary.current)
			return undefined;
		const image = preload();
		image.onload = () =>
		{
			setFellBackFor(null);
		};
		image.src = src;
		return () =>
		{
			image.onload = null;
		};
	}, [src, fallbackSrc, fellBackFor]);

	useEffect(() =>
	{
		if (failed !== null) return;
		const loaded = lastLoaded.current;
		setShown((current) =>
			sameImage(current) === sameImage(wanted) && (loading !== "lazy" || current === loaded) ? current : wanted,
		);
	}, [wanted, failed, loading]);

	// After a failure, show the img again once the wanted source preloads.
	useEffect(() =>
	{
		if (failed === null || wanted === failed) return undefined;
		const image = preload();
		image.onload = () =>
		{
			setShown(wanted);
			setFailed(null);
		};
		image.onerror = () =>
		{
			if (
				fallbackSrc !== undefined &&
				sameImage(wanted) === sameImage(src) &&
				sameImage(fallbackSrc) !== sameImage(src)
			)
			{
				failedPrimary.current = wanted;
				setFellBackFor(sameImage(src));
			}
		};
		image.src = wanted;
		return () =>
		{
			image.onload = null;
			image.onerror = null;
		};
	}, [wanted, failed, src, fallbackSrc]);

	if (failed !== null) return <>{fallback}</>;

	return (
		<img
			alt=""
			src={shown}
			referrerPolicy="no-referrer"
			loading={loading}
			fetchPriority={fetchPriority}
			decoding="async"
			className={imgClassName}
			onLoad={() =>
			{
				lastLoaded.current = shown;
				onLoad?.(fallbackSrc !== undefined && sameImage(shown) !== sameImage(src) ? "fallback" : "src");
			}}
			onError={() =>
			{
				if (
					fallbackSrc !== undefined &&
					sameImage(shown) === sameImage(src) &&
					sameImage(fallbackSrc) !== sameImage(src)
				)
				{
					failedPrimary.current = shown;
					setFellBackFor(sameImage(src));
					return;
				}
				setFailed(shown);
				onError?.();
			}}
		/>
	);
}
