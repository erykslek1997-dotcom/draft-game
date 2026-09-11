import { evaluateHistoricalChallenges } from '../engine/historicalChallenges';
import type { FitScoreResult } from '../engine/fit';
import type { ScoreBreakdown } from '../engine/scoring';
import type { SeasonProfileResult } from '../engine/seasonProfile';
import type { Team } from '../engine/types';

export default function HistoricalChallengesPanel({ team, breakdown, fit, season }: {
  team: Team;
  breakdown: ScoreBreakdown;
  fit: FitScoreResult;
  season: SeasonProfileResult;
}) {
  const challenges = evaluateHistoricalChallenges(team, breakdown, fit, season);
  const completed = challenges.filter((challenge) => challenge.completed).length;
  return (
    <details className="result-accordion-section historical-challenges-panel">
      <summary>Historical challenges — {completed}/{challenges.length} completed</summary>
      {/* 2026-09-11, user-reported live ("dobrze by było gdyby wszystkie kafelki się nie
          rozwijały, można tylko to co udało się zrobić") — every card used to dump its full
          condition-by-condition breakdown unconditionally, completed or not, so an early attempt
          (0-1/7 completed, the common case) read as a wall of red ✕'s. Each card is now its own
          `<details>`, open by default only when actually completed — the achievement is worth
          showing off, an in-progress attempt collapses to just its title + %, still one click
          away from the same detail. */}
      <div className="historical-challenge-grid">
        {challenges.map((challenge) => (
          <details
            key={challenge.id}
            className={`historical-challenge-card ${challenge.completed ? 'is-complete' : ''}`}
            open={challenge.completed}
          >
            <summary>{challenge.completed ? '✓' : `${challenge.progress}%`} {challenge.title}</summary>
            <span>{challenge.inspiration}</span>
            <ul>
              {challenge.conditions.map((entry) => (
                <li key={entry.label} className={entry.met ? 'condition-met' : 'condition-missed'}>
                  {entry.met ? '✓' : '×'} {entry.label} ({entry.value})
                </li>
              ))}
            </ul>
            <small>Reward: {challenge.bonus}</small>
          </details>
        ))}
      </div>
    </details>
  );
}
