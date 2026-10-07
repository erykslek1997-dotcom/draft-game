/** A small magnifier for the scouting affordances (the card corner, the strip). */
export function MagnifierIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="7" cy="7" r="4.6" />
      <path d="M10.4 10.4 14 14" />
    </svg>
  );
}
