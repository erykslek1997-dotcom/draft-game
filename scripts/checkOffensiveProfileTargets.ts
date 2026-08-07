import { players } from '../src/data/players';
import { computeOffensiveProfile, isRimGravityScorer, isSelfSufficientEngine } from '../src/engine/offensiveProfile';
import type { PlayerSpan } from '../src/data/schema';

const bestTal = (name: string, spanLabel?: string): PlayerSpan => {
  const spans = players.filter((p) => p.playerName === name && (!spanLabel || p.spanLabel === spanLabel));
  if (!spans.length) throw new Error('missing ' + name + ' ' + (spanLabel ?? ''));
  return spans[0];
};

const cases: { name: string; span?: string; expectRim?: boolean; expectSelfSufficient?: boolean }[] = [
  { name: 'Shaquille O\'Neal', expectRim: true, expectSelfSufficient: false },
  { name: 'Giannis Antetokounmpo', span: '2020-22', expectRim: true, expectSelfSufficient: false },
  { name: 'LeBron James', span: '2008-10', expectRim: true, expectSelfSufficient: true }, // pm=96 clears the elevated rim-gravity bar (90)
  { name: 'Stephen Curry', span: '2015-17', expectRim: false },
  { name: 'Steve Nash', span: '2005-07', expectRim: false, expectSelfSufficient: true },
  { name: 'Chris Paul', span: '2013-15', expectRim: false },
  { name: 'Rudy Gobert', expectRim: true, expectSelfSufficient: false },
];

for (const c of cases) {
  let span: PlayerSpan;
  try {
    span = bestTal(c.name, c.span);
  } catch (e) {
    console.log(c.name, c.span ?? '', '-> NOT FOUND');
    continue;
  }
  const profile = computeOffensiveProfile(span);
  const rim = isRimGravityScorer(span);
  const selfSuff = isSelfSufficientEngine(span);
  const rimMark = c.expectRim === undefined ? '' : rim === c.expectRim ? 'OK' : 'MISMATCH expected ' + c.expectRim;
  const selfMark = c.expectSelfSufficient === undefined ? '' : selfSuff === c.expectSelfSufficient ? 'OK' : 'MISMATCH expected ' + c.expectSelfSufficient;
  console.log(
    `${span.playerName.padEnd(22)} ${span.spanLabel.padEnd(8)} hasZone=${profile.hasZoneData} hasPM=${profile.hasPlaymakingData} ` +
      `rim=${profile.rimShare.toFixed(2)} mid=${profile.midShare.toFixed(2)} three=${profile.threeShare.toFixed(2)} spread=${profile.zoneSpread.toFixed(0)} ` +
      `rimVol=${profile.rimVolume.toFixed(1)} rimAcc=${profile.rimAccuracy.toFixed(0)} pm=${profile.playmakingGravity.toFixed(0)} ` +
      `| rimGravity=${rim}${rimMark ? ' [' + rimMark + ']' : ''} selfSufficient=${selfSuff}${selfMark ? ' [' + selfMark + ']' : ''}`,
  );
}
