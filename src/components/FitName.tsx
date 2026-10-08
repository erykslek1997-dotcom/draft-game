import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Face } from './ShotChip';

/** "LeBron James" → "L. James"; a one-word name stays as it is. */
export function shortPlayerName(name: string): string {
  const parts = name.split(' ');
  if (parts.length < 2) return name;
  return `${parts[0][0]}. ${parts.slice(1).join(' ')}`;
}

function initials(name: string): string {
  const p = name.split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
}

/**
 * A player's name never shows clipped (no "Tracy Mc…"): the full name, else "T. McGrady", else
 * the face (initials when there is no photo; plain initials when a face already sits next to the
 * name). The element the ref lands on must be the one that clips (overflow hidden, a set width or
 * a line clamp); the full name stays in its title and in the accessibility tree.
 */
export function useFitName<T extends HTMLElement>(name: string, faceNextToIt = false): { ref: RefObject<T | null>; content: ReactNode } {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  const [fit, setFit] = useState({ key: '', level: 0 });
  const key = `${name}|${width}`;
  const level = fit.key === key ? fit.level : 0;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || level >= 2) return;
    if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) setFit({ key, level: level + 1 });
  });

  useLayoutEffect(() => {
    const box = ref.current?.parentElement;
    if (!box || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setWidth(Math.round(box.clientWidth)));
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  const content =
    level === 0 ? (
      name
    ) : level === 1 ? (
      <>
        {shortPlayerName(name)}
        <span className="at-sr-only">{name}</span>
      </>
    ) : (
      <>
        {faceNextToIt ? initials(name) : <Face name={name} size="xs" />}
        <span className="at-sr-only">{name}</span>
      </>
    );
  return { ref, content };
}

export function FitName({ name, className, as: Tag = 'span', faceNextToIt }: { name: string; className?: string; as?: 'span' | 'b' | 'div'; faceNextToIt?: boolean }) {
  const { ref, content } = useFitName<HTMLElement>(name, faceNextToIt);
  return (
    <Tag ref={ref as RefObject<never>} className={className} title={name}>
      {content}
    </Tag>
  );
}
