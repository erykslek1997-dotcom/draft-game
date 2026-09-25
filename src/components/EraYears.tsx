import type { PlayerSpan } from '../data/schema';
import { eraStamp } from './eraNotes';

/** A span's years, stamped in the style of its era when it's from before the modern game.
 * `suffix` (e.g. "averages") goes inside the stamp, so years + label read as one tag. */
export function EraYears({ span, className, suffix }: { span: Pick<PlayerSpan, 'spanLabel'>; className?: string; suffix?: string }) {
  const era = eraStamp(span);
  const tail = suffix ? <span className="era-stamp-suffix"> {suffix}</span> : null;
  if (!era) return <span className={className}>{span.spanLabel}{tail}</span>;
  return (
    <span className={`${className ?? ''} era-stamp era-stamp--${era.key}`.trim()} title={era.title}>
      {span.spanLabel}
      {tail}
    </span>
  );
}
