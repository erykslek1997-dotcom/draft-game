import { careerResults, careerStats, levelOf } from '../online/career';
import { H3, Kv } from '../night/ui';

/**
 * 2026-11-12, the run's last word once the season or the tournament is over (the user: "na sam koniec
 * podsumowanie: które miejsce w PR, które w sezonie, ile XP"): the rows given, then the points and XP
 * the career entry earned, and the level bar.
 */
export function RunSummary({ rows, careerId, dayPoints }: { rows: [string, string][]; careerId: string; dayPoints?: number | null }) {
  const entry = careerResults().find((r) => r.id === careerId);
  const lv = levelOf(careerStats().xp);
  return (
    <section className="yrun">
      <H3>Your run</H3>
      {rows.map(([k, v]) => (
        <Kv key={k} k={k} v={v} />
      ))}
      {dayPoints != null ? <Kv k="Daily points" v={dayPoints.toFixed(1)} /> : entry ? <Kv k="Week points" v={`${entry.points > 0 ? '+' : ''}${entry.points.toFixed(1)}`} /> : null}
      {entry && <Kv k="XP" v={`+${entry.xp}`} />}
      <div className="m2-lv yrun-lv">
        <b>Level {lv.level}</b>
        <span className="m2-lv-bar" aria-hidden>
          <i style={{ width: `${Math.round((100 * lv.into) / lv.next)}%` }} />
        </span>
        <span>
          {lv.into}/{lv.next}
        </span>
      </div>
    </section>
  );
}
