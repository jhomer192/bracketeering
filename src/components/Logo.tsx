// Brand mark + wordmark.
//
// The mark is three descending horizontal bars — the universal shape of
// a top-N ranking. Used in the header on every page so the brand sits
// consistently across the flow.

export function LogoMark({
  size = 28,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      role="img"
      aria-label="Songrank"
      className={className}
    >
      <rect width="64" height="64" rx="14" fill="#09090b" />
      {/* Three bars, descending in length, left-aligned — reads as a
          top-N chart at any size. Spotify green for brand continuity. */}
      <rect x="11" y="18" width="42" height="7" rx="3" fill="#1db954" />
      <rect x="11" y="29" width="32" height="7" rx="3" fill="#1db954" />
      <rect x="11" y="40" width="22" height="7" rx="3" fill="#1db954" />
    </svg>
  );
}

/** Mark + wordmark, locked together. Used in the home hero and reveal header. */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark size={32} />
      <span className="font-bold tracking-tight text-[1.35em] leading-none">
        Songrank
      </span>
    </span>
  );
}
