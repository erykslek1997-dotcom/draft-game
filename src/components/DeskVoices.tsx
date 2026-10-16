import { DESK_CAST, type DeskLine } from '../engine/desk';
import { maskText } from './bombMask';

/** "@Sosini" in a reply shows as a mention. */
function withMentions(text: string, key: number) {
  const bits = text.split(/(@[A-Z][A-Za-z]+)/g);
  if (bits.length === 1) return text;
  return <span key={key}>{bits.map((b, k) => (k % 2 ? <b key={k} className="dk-at">{b}</b> : b))}</span>;
}

/** "The Desk" (engine/desk.ts): the panel's lines, each with its expert's badge. Stage cues
 * written as *text* show small and grey. */
export function DeskVoices({ voices }: { voices: DeskLine[] }) {
  return (
    <ul className="dk">
      {voices.map((v, i) => {
        const x = DESK_CAST[v.who];
        // The Bomb daily: his name stays out of the desk's lines until the results (bombMask.ts).
        const parts = maskText(v.text).split(/\*(.+?)\*/g).map((part, j) => (j % 2 ? <em key={j} className="dk-cue">{part}</em> : withMentions(part, j)));
        if (v.kind === 'burst') {
          return (
            <li className={`dk-ln dk-ln--burst${v.reply ? ' dk-ln--reply' : ''}`} key={i}>
              <span className="dk-gap" />
              <p className="dk-body">{parts}</p>
            </li>
          );
        }
        return (
          <li className={`dk-ln dk-ln--${v.kind}${v.reply ? ' dk-ln--reply' : ''}`} key={i}>
            <span className="dk-av" style={{ ['--h' as string]: x.hue }} aria-hidden>
              {x.mono}
            </span>
            <div className="dk-body">
              <span className="dk-head">
                <b>{x.name}</b>
                <small>{DESK_KIND_LABEL[v.kind]}</small>
              </span>
              <p>{parts}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

const DESK_KIND_LABEL: Record<DeskLine['kind'], string> = {
  host: 'host',
  praise: 'loves it',
  concern: 'concern',
  take: 'hot take',
  right: 'hot take · right this time',
  fact: 'the numbers',
  reply: 'replies',
  call: 'on the line',
  cuts: 'cuts in',
  defends: 'defends him',
  burst: '',
};
