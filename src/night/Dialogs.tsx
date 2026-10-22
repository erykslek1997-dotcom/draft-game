import { useState, type ReactNode } from 'react';
import { updateSettings, useSettings, type DraftSpeed, type Settings } from '../settings';
import { deckSoundsMuted, setDeckSoundsMuted } from '../components/deckSounds';
import { Btn, Dialog } from './ui';

/** Settings (mockup `alltime.html#settings`): draft speed, vibration, motion and the table sound. */
export function NightSettings({ onClose }: { onClose: () => void }) {
  const s = useSettings();
  const [muted, setMuted] = useState(deckSoundsMuted);
  const opt = <K extends keyof Settings>(key: K, value: Settings[K], label: string) => (
    <button key={String(value)} type="button" role="radio" aria-checked={s[key] === value} className={s[key] === value ? 'on' : undefined} onClick={() => updateSettings({ [key]: value } as Partial<Settings>)}>
      {label}
    </button>
  );
  const speeds: [DraftSpeed, string][] = [
    ['calm', 'Calm'],
    ['fast', 'Fast'],
    ['instant', 'Instant'],
  ];
  return (
    <Dialog title="Settings" onClose={onClose}>
      <div className="set-r">
        <b>Draft speed</b>
        <div className="set-opts" role="radiogroup" aria-label="Draft speed">
          {speeds.map(([v, l]) => opt('draftSpeed', v, l))}
        </div>
        <p>
          {s.draftSpeed === 'calm'
            ? 'Every CPU pick has a moment to read, the first round slowest.'
            : s.draftSpeed === 'fast'
              ? 'About three times quicker; you can still follow the board.'
              : 'The CPU picks straight through to your turn.'}{' '}
          All-Time and Mini, right away.
        </p>
      </div>
      <div className="set-r">
        <b>Vibration</b>
        <div className="set-opts" role="radiogroup" aria-label="Vibration">
          {opt('vibration', 'on', 'On')}
          {opt('vibration', 'off', 'Off')}
        </div>
        <p>A short buzz when you are on the clock, when you pick and when a game ends. Phones that support it.</p>
      </div>
      <div className="set-r">
        <b>Motion</b>
        <div className="set-opts" role="radiogroup" aria-label="Motion">
          {opt('motion', 'full', 'Full')}
          {opt('motion', 'reduced', 'Reduced')}
        </div>
        <p>Reduced skips card flips and slides; numbers still count up.</p>
      </div>
      <div className="set-r">
        <b>Sound</b>
        <div className="set-opts" role="radiogroup" aria-label="Sound">
          {(
            [
              [false, 'On'],
              [true, 'Off'],
            ] as const
          ).map(([m, l]) => (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={muted === m}
              className={muted === m ? 'on' : undefined}
              onClick={() => {
                setDeckSoundsMuted(m);
                setMuted(m);
              }}
            >
              {l}
            </button>
          ))}
        </div>
        <p>The deck of Draw Five: shuffle, deal and flip.</p>
      </div>
    </Dialog>
  );
}

/** How to play (mockup `alltime.html#howto`): a lead and numbered rules. */
export function NightHowTo({ lead, rules, onClose }: { lead: ReactNode; rules: [string, ReactNode][]; onClose: () => void }) {
  return (
    <Dialog title="How to play" onClose={onClose}>
      <p className="lead">{lead}</p>
      <ol className="rules">
        {rules.map(([t, b], i) => (
          <li key={t}>
            <span>{i + 1}</span>
            <div>
              <b>{t}</b>
              <p>{b}</p>
            </div>
          </li>
        ))}
      </ol>
      <Btn onClick={onClose}>Got it</Btn>
    </Dialog>
  );
}

/** A yes / no question (mockup `alltime.html#leave`). */
export function NightConfirm({ title, lead, yes, no, onYes, onNo }: { title: ReactNode; lead: ReactNode; yes: string; no: string; onYes: () => void; onNo: () => void }) {
  return (
    <Dialog title={title} small>
      <p className="lead">{lead}</p>
      <div className="btn2">
        <Btn onClick={onNo}>{no}</Btn>
        <Btn kind="line" onClick={onYes}>
          {yes}
        </Btn>
      </div>
    </Dialog>
  );
}
