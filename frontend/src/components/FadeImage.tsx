import { useEffect, useRef, useState } from "react";

/**
 * Image component that always fades in on mount, regardless of whether the
 * image is cached or not. Use this for consistent fade-in aesthetics when
 * browsing/paginating.
 *
 * To ensure fade-in happens on page changes, give this component a `key` prop
 * that changes when you want the fade to re-trigger (e.g., include page number
 * or listing ID in the key).
 */
type FadeImageProps = React.ImgHTMLAttributes<HTMLImageElement> & {
    /**
     * If false, the component will keep the image hidden even if it finishes loading.
     * When it flips to true (and the image is loaded/decoded), the fade will run.
     *
     * Useful for carousels where off-screen slides can finish loading before they
     * become visible.
     */
    revealWhen?: boolean;
};

export default function FadeImage({
    src,
    alt,
    className = "",
    style,
    loading = "lazy",
    decoding = "async",
    revealWhen = true,
    ...rest
}: FadeImageProps) {
    const imgRef = useRef<HTMLImageElement>(null);
    const [loaded, setLoaded] = useState(false);
    const [visible, setVisible] = useState(false);

    const desiredOpacityRaw = style?.opacity;
    const desiredOpacity =
        typeof desiredOpacityRaw === "number"
            ? desiredOpacityRaw
            : typeof desiredOpacityRaw === "string"
                ? Number.parseFloat(desiredOpacityRaw)
                : 1;
    const finalOpacity = Number.isFinite(desiredOpacity) ? desiredOpacity : 1;

    useEffect(() => {
        setLoaded(false);
        setVisible(false);

        const img = imgRef.current;
        if (!img) return;

        const el = img;
        async function markLoaded() {
            // Wait for decode so the fade starts when the bitmap is actually ready to paint.
            const p = typeof el.decode === "function" ? el.decode() : Promise.resolve();
            await p.catch(() => { });
            setLoaded(true);
        }

        if (el.complete && el.naturalWidth !== 0) {
            void markLoaded();
            return;
        }

        const onLoad = () => void markLoaded();
        const onError = () => setLoaded(true);
        el.addEventListener("load", onLoad);
        el.addEventListener("error", onError);
        return () => {
            el.removeEventListener("load", onLoad);
            el.removeEventListener("error", onError);
        };
    }, [src]);

    useEffect(() => {
        if (!loaded) return;
        if (!revealWhen) return;
        if (visible) return;

        // Use requestAnimationFrame to ensure the initial opacity:0 has painted
        // before we trigger the transition (prevents cached images from skipping the fade).
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                setVisible(true);
            });
        });
    }, [loaded, revealWhen, visible]);

    return (
        <img
            ref={imgRef}
            src={src}
            alt={alt}
            loading={loading}
            decoding={decoding}
            data-no-fade // Opt out of the global fade system to avoid conflicts
            className={className}
            style={{
                ...style,
                opacity: visible ? finalOpacity : 0,
                transition: "opacity 400ms ease-out",
            }}
            {...rest}
        />
    );
}
