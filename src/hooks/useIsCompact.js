import { useEffect, useState } from "react";

export default function useIsCompact(maxWidth = 760) {
  const query = `(max-width: ${maxWidth}px)`;
  const initial =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(query).matches;
  const [compact, setCompact] = useState(initial);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const media = window.matchMedia(query);
    const onChange = (e) => setCompact(Boolean(e.matches));
    setCompact(Boolean(media.matches));
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [query]);

  return compact;
}
