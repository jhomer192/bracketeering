// Brand mark + wordmark.
//
// The mark is a tournament bracket collapsing 4 → 2 → 1 — the literal shape
// of what the app does. Used in the header on every page so the brand sits
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
      aria-label="Bracketeering"
      className={className}
    >
      <rect width="64" height="64" rx="14" fill="#09090b" />
      <g
        stroke="#1db954"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M11 14h10" />
        <path d="M11 24h10" />
        <path d="M11 40h10" />
        <path d="M11 50h10" />
        <path d="M21 14v5h7" />
        <path d="M21 24v-5h7" />
        <path d="M21 40v5h7" />
        <path d="M21 50v-5h7" />
        <path d="M28 19h6" />
        <path d="M28 45h6" />
        <path d="M34 19v9h7" />
        <path d="M34 45v-9h7" />
      </g>
      <circle cx="48" cy="32" r="5" fill="#1db954" />
      <path
        d="M41 32h2"
        stroke="#1db954"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Mark + wordmark, locked together. Used in the home hero and reveal header. */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark size={32} />
      <span className="font-bold tracking-tight text-[1.35em] leading-none">
        Bracketeering
      </span>
    </span>
  );
}
