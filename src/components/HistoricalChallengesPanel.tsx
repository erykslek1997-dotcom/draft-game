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
      <div className="historical-challenge-grid">
        {challenges.map((challenge) => (
          <article key={challenge.id} className={`historical-challenge-card ${challenge.completed ? 'is-complete' : ''}`}>
            <strong>{challenge.completed ? '✓' : `${challenge.progress}%`} {challenge.title}</strong>
            <span>{challenge.inspiration}</span>
            <ul>
              {challenge.conditions.map((entry) => (
                <li key={entry.label} className={entry.met ? 'condition-met' : 'condition-missed'}>
                  {entry.met ? '✓' : '×'} {entry.label} ({entry.value})
                </li>
              ))}
            </ul>
            <small>Reward: {challenge.bonus}</small>
          </article>
        ))}
      </div>
    </details>
  );
}
