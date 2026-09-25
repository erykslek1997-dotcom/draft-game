import type { PlayerSpan } from '../data/schema';
import { eraStamp } from './eraNotes';

/** A span's years, stamped in the style of its era when it's from before the modern game. */
export function EraYears({ span, className }: { span: Pick<PlayerSpan, 'spanLabel'>; className?: string }) {
  const era = eraStamp(span);
  if (!era) return <span className={className}>{span.spanLabel}</span>;
  return (
    <span className={`${className ?? ''} era-stamp era-stamp--${era.key}`.trim()} title={era.title}>
      {span.spanLabel}
    </span>
  );
}
