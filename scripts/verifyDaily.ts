import { verifyDaily, type DailyProof } from '../src/online/verifyDaily';
import type { DailyDraftMode } from '../src/dailyDraftDay';

/**
 * 2026-11-11: the hourly leaderboard check (.github/workflows/verify-daily.yml). Reads the rows still
 * 'pending' through Supabase's REST API with the secret key (SUPABASE_URL, SUPABASE_SECRET_KEY from
 * repository secrets), re-runs each draft (src/online/verifyDaily.ts), marks it 'ok' / 'ai-diverged'
 * or deletes it when the draft or the score is false. Mini rows have no proof yet: 'unchecked'.
 */
const base = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!base || !key) {
  console.log('SUPABASE_URL / SUPABASE_SECRET_KEY not set; nothing to check.');
  process.exit(0);
}
const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const rest = `${base.replace(/\/$/, '')}/rest/v1/daily_scores`;

interface Row { user_id: string; mode: DailyDraftMode; day: string; overall: number; place: number; field: number; proof: DailyProof | null }
const res = await fetch(`${rest}?verified=eq.pending&select=user_id,mode,day,overall,place,field,proof&limit=200`, { headers });
if (!res.ok) throw new Error(`read failed: ${res.status} ${await res.text()}`);
const rows = (await res.json()) as Row[];
console.log(`${rows.length} pending`);
const where = (r: Row) => `user_id=eq.${r.user_id}&mode=eq.${r.mode}&day=eq.${r.day}`;
for (const r of rows) {
  let status: string;
  if (r.mode === 'mini') status = 'unchecked';
  else if (!r.proof) status = 'rejected';
  else {
    const v = verifyDaily(r.mode, r.day, r.proof, { overall: Number(r.overall), place: r.place, field: r.field });
    status = v.status;
    if (v.status === 'rejected') console.log(`rejected ${r.mode} ${r.day} ${r.user_id}: ${v.reason}`);
  }
  if (status === 'rejected') await fetch(`${rest}?${where(r)}`, { method: 'DELETE', headers });
  else await fetch(`${rest}?${where(r)}`, { method: 'PATCH', headers, body: JSON.stringify({ verified: status }) });
  console.log(`${r.mode} ${r.day} ${r.user_id.slice(0, 8)} → ${status}`);
}
