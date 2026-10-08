import type { ReactNode } from 'react';
import { FitName } from './FitName';
import { Face } from './ShotChip';

/**
 * 2026-10-08, the user ("gubi mi się spójność"): one way to show a player in a list, in two sizes —
 * `lead` for the ones that matter most (a starting five, an All-Star starter), `support` for
 * everyone around them (the bench, reserves, key players). Always the same parts in the same
 * places: an optional tag (position), the face, the name over one line of detail, a value on the
 * right. The roster, the share card, the series panel and the All-Stars all use it.
 */
export function PlayerRow({
  size,
  name,
  meta,
  tag,
  value,
  unit,
  isYou = false,
}: {
  size: 'lead' | 'support';
  name: string;
  meta?: ReactNode;
  tag?: string;
  value?: ReactNode;
  unit?: string;
  isYou?: boolean;
}) {
  return (
    <div className={`pr pr--${size}${tag ? ' has-tag' : ''}${isYou ? ' is-you' : ''}`}>
      {tag && <span className="pr-tag">{tag}</span>}
      <Face name={name} size={size === 'lead' ? 'md' : 'sm'} />
      <span className="pr-txt">
        <FitName as="b" name={name} faceNextToIt />
        {meta && <small>{meta}</small>}
      </span>
      {value !== undefined && (
        <span className="pr-val">
          {value}
          {unit && <small>{unit}</small>}
        </span>
      )}
    </div>
  );
}

/** A small heading inside a card of rows ("Starting five", "Bench"). */
export function RowsLabel({ children }: { children: ReactNode }) {
  return <div className="pr-label">{children}</div>;
}
