import { useId } from 'react';
import { franchiseByName } from '../data/franchises';
import { logoMarkup } from './teamLogoKit';

/** A franchise's logo (data/franchises.ts), drawn from code. Decorative: the name is always shown
 * next to it, so it is hidden from screen readers. Renders nothing for a name outside the pool. */
export function TeamLogo({ name, size = 24, className }: { name: string; size?: number; className?: string }) {
  const clipId = `tl${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const franchise = franchiseByName(name);
  if (!franchise) return null;
  return (
    <svg
      className={`team-logo${className ? ` ${className}` : ''}`}
      viewBox="0 0 100 100"
      width={size}
      height={size}
      aria-hidden
      focusable="false"
      dangerouslySetInnerHTML={{ __html: logoMarkup(franchise.logo, clipId) }}
    />
  );
}
