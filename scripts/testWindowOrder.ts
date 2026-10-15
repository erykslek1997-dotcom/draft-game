import { normalizePlayerName } from '../src/data/schema';
import { draftPool } from '../src/data/draftPool';
import { USER_WINDOW_ORDER } from '../src/data/userTierCalibration';
import { effectiveTalent } from '../src/engine/grades';
import { peakDraftPool } from '../src/engine/peakDraftPool';

/**
 * The user's own order of a player's best windows (`USER_WINDOW_ORDER`): the listed windows read
 * in that order, every other window of his reads below them, and the first is the window the
 * draft offers by default.
 */
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}

for (const [name, order] of Object.entries(USER_WINDOW_ORDER)) {
  const spans = draftPool.filter((s) => normalizePlayerName(s.playerName) === normalizePlayerName(name));
  const tal = (label: string) => effectiveTalent(spans.find((s) => s.spanLabel === label)!);
  check(order.every((label) => spans.some((s) => s.spanLabel === label)), `${name}: every listed window is in the pool`);
  check(order.every((label, i) => i === 0 || tal(order[i - 1]) > tal(label)), `${name}: ${order.map((l) => `${l} ${tal(l)}`).join(' > ')}`);
  const last = tal(order[order.length - 1]);
  const others = spans.filter((s) => !order.includes(s.spanLabel));
  check(others.every((s) => effectiveTalent(s) < last), `${name}: his other ${others.length} windows read below ${order[order.length - 1]}`);
  const peak = peakDraftPool.find((s) => normalizePlayerName(s.playerName) === normalizePlayerName(name));
  check(peak?.spanLabel === order[0], `${name}: the draft offers ${order[0]} by default`);
}
