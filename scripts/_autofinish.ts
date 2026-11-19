import { autoFinishDraft, createDraft } from '../src/engine/draft';
const t0 = Date.now(); let s = createDraft(false, undefined, 'Test', 501); let i = 0;
while (!s.complete && i++ < 400) s = autoFinishDraft(s, 8);
console.log('picks', s.history.length, 'seconds', ((Date.now() - t0) / 1000).toFixed(1));
