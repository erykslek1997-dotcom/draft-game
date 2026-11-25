import { envVar } from './env';
/**
 * 2026-11-25 (`ERA_MASK=1`, measurement only): the engine as if every window were from 1974-96 — no data
 * that only exists from 1996-97 on (DARKO, RAPTOR, PIPM, BPM 2.0, tracking / matchup defense, play-by-play
 * shot data and self-creation, NBA.com usage, teammate lift, RAPM, pbpstats); skills from the box-era model
 * (src/data/skillsMasked.json). Run on 1997+ real teams, it measures what the bridges lose.
 */
export const ERA_MASK = envVar('ERA_MASK') === '1';
