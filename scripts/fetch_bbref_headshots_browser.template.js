/*
 * Basketball-Reference headshots, pulled from inside the browser (2026-10-29): the players the NBA's
 * image server had no photo for. Saves one file, headshots_bbref.json, for
 * scripts/importHeadshots.ts. Built by: npx tsx scripts/buildBbrefHeadshotScript.ts
 *
 * 1. Open https://www.basketball-reference.com in Chrome or Edge.
 * 2. Press F12, open the "Console" tab. If it asks, type   allow pasting   and press Enter.
 * 3. Paste this whole file and press Enter.
 * 4. Leave the tab open. Basketball-Reference allows about 20 requests a minute (more locks you out
 *    for an hour), so the script waits 3.5 s after each, two a player: ~450 players ≈ 55 minutes. Progress
 *    shows in the console. If the file did not save, type  bbrefHeadshotsDownload()  and press Enter.
 *
 * FIRST RUN IS A TEST (TEST = true): five players only. Paste the console lines to Claude; when they
 * look right, set TEST = false and run again.
 */
(async () => {
  const TEST = true;
  const PLAYERS = __PLAYERS__; // [name, Basketball-Reference id, id guessed]
  const PAUSE_MS = 3500;
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

  // The photo's address is read off the player's own page (2026-10-29: the guessed image folders
  // both answered 404), so a player without a photo there simply has none: two requests a player.
  async function get(url, as) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const res = await fetch(url, { credentials: 'omit' });
      await sleep(PAUSE_MS);
      if (res.status === 429) {
        console.log('  429: too many requests, waiting a minute');
        await sleep(60000);
        continue;
      }
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      return as === 'text' ? res.text() : res.blob();
    }
    throw new Error(`HTTP 429 three times ${url}`);
  }

  async function one([name, id, guessed]) {
    try {
      const html = await get(`/players/${id[0]}/${id}.html`, 'text');
      if (html == null) return missing.push([name, id, guessed ? 'no page (guessed id)' : 'no page']);
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const title = doc.querySelector('#meta h1')?.textContent.trim() ?? '';
      const src = doc.querySelector('#meta .media-item img')?.getAttribute('src');
      if (!src) return missing.push([name, id, `no photo on the page (${title})`]);
      const blob = await get(src, 'blob');
      if (!blob || !blob.type.startsWith('image/')) return missing.push([name, id, `photo did not load: ${src}`]);
      photos[`bb-${id}`] = { name, jpg: await toBase64(blob), guessed, page: title, src };
    } catch (e) {
      errors.push([name, id, String(e && e.message ? e.message : e)]);
    }
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

  console.log(`BBRef headshots: ${list.length} players${TEST ? ' (TEST)' : ''}, about ${Math.ceil((list.length * PAUSE_MS * 2) / 60000)} min`);
  for (let i = 0; i < list.length; i++) {
    await one(list[i]);
    if ((i + 1) % 20 === 0 || i + 1 === list.length) console.log(`  ${i + 1}/${list.length} · ${Object.keys(photos).length} photos · ${missing.length} without one · ${errors.length} errors`);
  }
  console.log(`Done: ${Object.keys(photos).length} photos, ${missing.length} without one, ${errors.length} errors.`);
  if (TEST) {
    for (const [id, p] of Object.entries(photos)) console.log(`  ${p.name} (${id}) → page "${p.page}" · ${Math.round((p.jpg.length * 3) / 4 / 1024)} KB · ${p.src}`);
    for (const m of [...missing, ...errors]) console.log(`  ${m.join(' · ')}`);
  }
  save();
})();
