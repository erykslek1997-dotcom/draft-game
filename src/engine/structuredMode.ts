import { envVar } from './env';
/**
 * 2026-11-05, the user ("okej, no to kalibrujemy" → "1. Człowiek jak było wcześniej / 2. Okej"): the
 * structured roster (`structuredRoster.ts`) is how the CPU teams draft and play — five starters at
 * their own positions, three backups covering the five, one salary glue, the structured 8-man
 * rotation. The human drafts and sets his rotation as before.
 *
 * `STRUCT=0` in the environment turns it off (the classic CPU drafting and rotation), `STRUCT=1` on;
 * unset, it is on.
 */
export const STRUCTURED_AI = (envVar('STRUCT') ?? '1') === '1';
