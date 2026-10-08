import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Face } from './ShotChip';

/** "LeBron James" → "L. James"; a one-word name stays as it is. */
function shortPlayerName(name: string): string {
  const parts = name.split(' ');
  if (parts.length < 2) return name;
  return `${parts[0][0]}. ${parts.slice(1).join(' ')}`;
}

/** "Giannis Antetokounmpo" → "Giannis A." — for a surname too long for even the short form. */
function firstNameShort(name: string): string {
  const parts = name.split(' ');
  if (parts.length < 2) return name;
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

function initials(name: string): string {
  const p = name.split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
}

/**
 * The first of `variants` that fits its box, or the last one. The element the ref lands on must
 * be the one that clips (overflow hidden, a set width or a line clamp). Re-measured whenever the
 * key or the box's width changes.
 */
function useFit<T extends HTMLElement>(variants: ReactNode[], key: string): { ref: RefObject<T | null>; content: ReactNode } {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  const [fit, setFit] = useState({ key: '', level: 0 });
  const fullKey = `${key}|${width}`;
  const level = fit.key === fullKey ? fit.level : 0;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || level >= variants.length - 1) return;
    if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) setFit({ key: fullKey, level: level + 1 });
  });

  // A wider box starts again from the full form. The element's own box can also shrink while its
  // row stays put (a neighbour fills in later), and a late web font changes the text's width:
  // both just re-check, which only ever steps down.
  const [, setTick] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    const box = el?.parentElement;
    if (!el || !box || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setWidth(Math.round(box.clientWidth)));
    ro.observe(box);
    const own = new ResizeObserver(() => setTick((t) => t + 1));
    own.observe(el);
    let live = true;
    document.fonts?.ready.then(() => live && setTick((t) => t + 1));
    return () => {
      live = false;
      ro.disconnect();
      own.disconnect();
    };
  }, []);

  return { ref, content: variants[level] };
}

/**
 * A player's name never shows clipped (no "Tracy Mc…"): the full name, else "T. McGrady", else
 * "Tracy M.", else the face (initials when there is no photo; plain initials when a face already
 * sits next to the name). The full name stays in the title and in the accessibility tree.
 */
export function useFitName<T extends HTMLElement>(name: string, faceNextToIt = false): { ref: RefObject<T | null>; content: ReactNode } {
  const sr = <span className="at-sr-only">{name}</span>;
  return useFit<T>(
    [
      name,
      <>
        {shortPlayerName(name)}
        {sr}
      </>,
      <>
        {firstNameShort(name)}
        {sr}
      </>,
      <>
        {faceNextToIt ? initials(name) : <Face name={name} size="xs" />}
        {sr}
      </>,
    ],
    name,
  );
}

export function FitName({ name, className, as: Tag = 'span', faceNextToIt }: { name: string; className?: string; as?: 'span' | 'b' | 'div'; faceNextToIt?: boolean }) {
  const { ref, content } = useFitName<HTMLElement>(name, faceNextToIt);
  return (
    <Tag ref={ref as RefObject<never>} className={className} title={name}>
      {content}
    </Tag>
  );
}

/**
 * A team's name, same rule as a player's: "Long Beach Boilermakers", else "Boilermakers", else
 * the code (when there is one). `mascotFirst` starts at the mascot (the bracket). `after` (a "you" tag) rides along.
 */
export function FitTeam({ name, code, className, after, mascotFirst }: { name: string; code?: string; className?: string; after?: ReactNode; mascotFirst?: boolean }) {
  const sr = <span className="at-sr-only">{name}</span>;
  const mascot = name.split(' ').slice(-1)[0];
  const variants: ReactNode[] = [
    ...(mascotFirst ? [] : [<>{name}{after}</>]),
    <>{mascot}{sr}{after}</>,
    ...(code ? [<>{code}{sr}{after}</>] : []),
  ];
  const { ref, content } = useFit<HTMLSpanElement>(variants, `${name}|${mascotFirst}`);
  return (
    <span ref={ref} className={className} title={name}>
      {content}
    </span>
  );
}

/** Just the surname where a slot only has room for one word ("Pierce"); if even that doesn't fit, the face. */
export function FitSurname({ name, className }: { name: string; className?: string }) {
  const sr = <span className="at-sr-only">{name}</span>;
  const surname = name.split(' ').slice(-1)[0];
  const { ref, content } = useFit<HTMLSpanElement>(
    [
      surname,
      <>
        <Face name={name} size="xs" />
        {sr}
      </>,
    ],
    name,
  );
  return (
    <span ref={ref} className={className} title={name}>
      {content}
    </span>
  );
}
