import type { CSSProperties, ReactNode } from 'react';
import { Face } from './ShotChip';
import { TeamLogo } from './TeamLogo';
import { TeamMark } from './ResultsReport';
import { hasTeamLogo, teamHue } from './teamLogoKit';

/**
 * 2026-10-15 (playtest 13: the share card was "dalej bez jajca" — a table from the report; and 9:
 * no card after the season): one poster shape for both — the team's colours and logo on a band,
 * the result big, the style line as the title, the starting five as faces, the grades as chips.
 */
export function SharePoster({
  teamName,
  teamCode,
  kicker,
  children,
  footRight,
}: {
  teamName: string;
  teamCode: string;
  kicker: string;
  children: ReactNode;
  footRight: string;
}) {
  const hue = teamHue(teamName);
  const style = { '--sp-hue': String(hue) } as CSSProperties;
  return (
    <div className="sp" style={style}>
      <div className="sp-band">
        {hasTeamLogo(teamName) ? <TeamLogo name={teamName} size={76} className="sp-logo" /> : <TeamMark code={teamCode} name={teamName} size="md" />}
        <span className="sp-band-t">
          <span className="sp-kicker">{kicker}</span>
          <span className="sp-name">{teamName}</span>
        </span>
      </div>
      <div className="sp-body">{children}</div>
      <div className="sp-foot">
        <span>Draftverse</span>
        <span>{footRight}</span>
      </div>
    </div>
  );
}

/** The starting five as faces in a row: last name and one line under each. */
export function PosterFive({ players }: { players: { name: string; line: string }[] }) {
  return (
    <div className="sp-five">
      {players.map((p) => (
        <span key={p.name} className="sp-five-p">
          <Face name={p.name} size="md" />
          <b>{p.name.split(' ').slice(-1)[0]}</b>
          <small>{p.line}</small>
        </span>
      ))}
    </div>
  );
}

/** Scores as small grade chips rather than full bars. */
export function PosterGrades({ rows }: { rows: { label: string; grade: string }[] }) {
  return (
    <div className="sp-grades">
      {rows.map((r) => (
        <span key={r.label} className="sp-grade">
          <small>{r.label}</small>
          <b className={`rr-grade rr-g-${r.grade}`}>{r.grade}</b>
        </span>
      ))}
    </div>
  );
}
