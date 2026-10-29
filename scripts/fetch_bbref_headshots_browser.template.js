/*
 * Basketball-Reference headshots, pulled from inside the browser (2026-10-29): the players the NBA's
 * image server had no photo for. Saves one file, headshots_bbref.json, for
 * scripts/importHeadshots.ts. Built by: npx tsx scripts/buildBbrefHeadshotScript.ts
 *
 * 1. Open https://www.basketball-reference.com in Chrome or Edge.
 * 2. Press F12, open the "Console" tab. If it asks, type   allow pasting   and press Enter.
 * 3. Paste this whole file and press Enter.
 * 4. Leave the tab open. Basketball-Reference allows about 20 requests a minute (more locks you out
 *    for an hour), so the script waits 3.5 s after each: ~450 players ≈ 30-40 minutes. Progress
 *    shows in the console. If the file did not save, type  bbrefHeadshotsDownload()  and press Enter.
 *
 * FIRST RUN IS A TEST (TEST = true): five players only. Paste the console lines to Claude; when they
 * look right, set TEST = false and run again.
 */
(async () => {
  const TEST = true;
  const PLAYERS = __PLAYERS__; // [name, Basketball-Reference id, id guessed]
  const PAUSE_MS = 3500;
  // BBRef has kept its photos under two folders over the years; the first that answers wins.
  const PATHS = ['/req/202106291/images/headshots/', '/req/202106291/images/players/'];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const list = TEST ? PLAYERS.slice(0, 5) : PLAYERS;
  const photos = {};
  const missing = [];
  const errors = [];

  const toBase64 = (blob) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1]);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });

  async function one([name, id, guessed]) {
    for (const dir of PATHS) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const res = await fetch(`${dir}${id}.jpg`, { credentials: 'omit' });
          await sleep(PAUSE_MS);
          if (res.status === 429) throw new Error('HTTP 429 (too many requests)');
          if (res.status === 404 || res.status === 403) break; // not in this folder
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          if (!blob.type.startsWith('image/')) break;
          photos[`bb-${id}`] = { name, jpg: await toBase64(blob), guessed };
          return;
        } catch (e) {
          if (attempt === 3) {
            errors.push([name, id, String(e && e.message ? e.message : e)]);
            return;
          }
          await sleep(attempt * 30000); // a 429 wants a real pause
        }
      }
    }
    missing.push([name, id, guessed ? 'no photo (guessed id)' : 'no photo']);
  }

  function save() {
    const body = JSON.stringify({ made: new Date().toISOString(), test: TEST, source: 'bbref', photos, missing, errors });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
    a.download = TEST ? 'headshots_bbref_test.json' : 'headshots_bbref.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  window.bbrefHeadshotsDownload = save;

  console.log(`BBRef headshots: ${list.length} players${TEST ? ' (TEST)' : ''}, about ${Math.ceil((list.length * PAUSE_MS * 1.3) / 60000)} min`);
  for (let i = 0; i < list.length; i++) {
    await one(list[i]);
    if ((i + 1) % 20 === 0 || i + 1 === list.length) console.log(`  ${i + 1}/${list.length} · ${Object.keys(photos).length} photos · ${missing.length} without one · ${errors.length} errors`);
  }
  console.log(`Done: ${Object.keys(photos).length} photos, ${missing.length} without one, ${errors.length} errors.`);
  if (TEST) {
    for (const [id, p] of Object.entries(photos)) console.log(`  ${p.name} (${id}): ${Math.round((p.jpg.length * 3) / 4 / 1024)} KB`);
    for (const m of [...missing, ...errors]) console.log(`  ${m.join(' · ')}`);
  }
  save();
})();
