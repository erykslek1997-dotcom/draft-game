import { cx } from '../night/ui';

export interface MetricRowData {
  label: string;
  value: number;
  /** The field's median, a tick on the bar. */
  median?: number;
  /** Rank among the field (1 = best) and the field's size. */
  rank?: number;
  of?: number;
  hint?: string;
  /** Free text in the third column. */
  note?: string;
  /** What the number column shows in place of the value ("44%"). */
  shown?: string;
}

const TOP = 4;

/**
 * 2026-10-22, the night edition's "More" panels on the results (the user: "sekcja More ma w środku
 * jeszcze stary styl"): one printed table for every metric — label, number, rank, a quiet bar with
 * the field's median as a tick. A rank in the field's top four reads in green with ▲, the bottom
 * four in red with ▼ (the sign carries the meaning, not the colour alone).
 */
export function MetricTable({ rows }: { rows: MetricRowData[] }) {
  return (
    <table className="profile mtab">
      <tbody>
        {rows.map((r) => {
          const v = Math.max(0, Math.min(100, Math.round(r.value)));
          const top = r.rank !== undefined && r.rank <= TOP;
          const bottom = r.rank !== undefined && r.of !== undefined && r.rank > r.of - TOP;
          return (
            <tr key={r.label} className={cx(top && 'good', bottom && 'weak')} title={r.hint}>
              <td className="l">{r.label}</td>
              <td className="v">{r.shown ?? v}</td>
              <td className="b">{r.rank !== undefined ? `${top ? '▲ ' : bottom ? '▼ ' : ''}#${r.rank}` : (r.note ?? '')}</td>
              <td>
                <div className="bar">
                  <i style={{ width: `${v}%` }} />
                  {r.median !== undefined && <u style={{ left: `${Math.max(0, Math.min(100, r.median))}%` }} />}
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
