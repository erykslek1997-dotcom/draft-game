/*
 * NBA.com headshots, pulled from inside the browser (2026-10-29): the players in the draft pool
 * whose photo the game doesn't have yet. Saves one file, headshots_nba.json, for
 * scripts/importHeadshots.ts. Built by: npm run download:headshots -- --browser-script
 *
 * 1. Open this address in Chrome or Edge (one photo on the NBA's own image server — the script has
 *    to run there, or the browser won't let it read the photos):
 *      https://cdn.nba.com/headshots/nba/latest/1040x760/2544.png
 * 2. Press F12, open the "Console" tab. If it asks, type   allow pasting   and press Enter.
 * 3. Paste this whole file and press Enter.
 * 4. Leave the tab open. About 900 photos at 6 at a time take a few minutes; progress shows in the
 *    console. If the file did not save, type  headshotsDownload()  and press Enter.
 *
 * FIRST RUN IS A TEST (TEST = true): five players only. Paste the console lines to Claude; when they
 * look right, set TEST = false and run again.
 */
(async () => {
  const TEST = true;
  const PLAYERS = __PLAYERS__; // [name, NBA person id]
  const WIDTH = 160; // the game shows them at 26-72 px; scripts/resizeHeadshots.ts keeps the same width
  const AT_ONCE = 6;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const list = TEST ? PLAYERS.slice(0, 5) : PLAYERS;
  const photos = {};
  const missing = [];
  const errors = [];
  let done = 0;

  const toBase64 = (blob) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1]);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });

  async function one([name, id]) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(`/headshots/nba/latest/1040x760/${id}.png`, { credentials: 'omit' });
        if (res.status === 403 || res.status === 404) {
          missing.push([name, id, `HTTP ${res.status}`]);
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (!blob.type.startsWith('image/')) {
          missing.push([name, id, `not an image: ${blob.type}`]);
          return;
        }
        const bmp = await createImageBitmap(blob);
        const h = Math.round((bmp.height * WIDTH) / bmp.width);
        const canvas = new OffscreenCanvas(WIDTH, h);
        canvas.getContext('2d').drawImage(bmp, 0, 0, WIDTH, h);
        const small = await canvas.convertToBlob({ type: 'image/webp', quality: 0.9 });
        photos[id] = { name, webp: await toBase64(small) };
        return;
      } catch (e) {
        if (attempt === 3) errors.push([name, id, String(e && e.message ? e.message : e)]);
        else await sleep(1000 * attempt);
      }
    }
  }

  function save() {
    const body = JSON.stringify({ made: new Date().toISOString(), test: TEST, photos, missing, errors });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
    a.download = TEST ? 'headshots_nba_test.json' : 'headshots_nba.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  window.headshotsDownload = save;

  console.log(`Headshots: ${list.length} players to fetch${TEST ? ' (TEST)' : ''}`);
  let next = 0;
  await Promise.all(
    Array.from({ length: AT_ONCE }, async () => {
      while (next < list.length) {
        await one(list[next++]);
        if (++done % 50 === 0 || done === list.length) console.log(`  ${done}/${list.length} · ${Object.keys(photos).length} photos · ${missing.length} without one · ${errors.length} errors`);
      }
    }),
  );
  console.log(`Done: ${Object.keys(photos).length} photos, ${missing.length} without one, ${errors.length} errors.`);
  if (TEST) {
    for (const [id, p] of Object.entries(photos)) console.log(`  ${p.name} (${id}): ${Math.round((p.webp.length * 3) / 4 / 1024)} KB`);
    for (const m of [...missing, ...errors]) console.log(`  ${m.join(' · ')}`);
  }
  save();
})();
