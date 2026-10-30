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
  const TEST = false; // the second pass: the 193 the first run lost to "Failed to fetch"
  const PLAYERS = [["Nate Robinson", "robinna01", false], ["Truck Robinson", "robintr01", false], ["Tree Rollins", "rollitr01", false], ["Sean Rooks", "rooksse01", false], ["Quinton Ross", "rossqu01", false], ["Campy Russell", "russeca02", false], ["John Salley", "sallejo01", false], ["Ralph Sampson", "sampsra01", false], ["Danny Schayes", "schayda01", false], ["Malik Sealy", "sealyma01", false], ["Rony Seikaly", "seikaro01", false], ["Lonnie Shelton", "sheltlo01", false], ["John Shumate", "shumajo01", false], ["Jerry Sichting", "sichtje01", false], ["Paul Silas", "silaspa01", false], ["Lionel Simmons", "simmoli01", false], ["Chris Singleton", "singlch01", false], ["Brian Skinner", "skinnbr01", false], ["Charles Smith", "smithch01", false], ["Chris Smith", "smithch03", false], ["Michael Smith", "smithmi02", false], ["Phil Smith", "smithph01", false], ["Rik Smits", "smitsri01", false], ["Dick Snyder", "snydedi01", false], ["Ricky Sobers", "soberri01", false], ["Jim Spanarkel", "spanaji01", false], ["Felton Spencer", "spencfe01", false], ["John Starks", "starkjo01", false], ["Larry Stewart", "stewala01", false], ["Steve Stipanovich", "stipast01", false], ["Bryant Stith", "stithbr01", false], ["Maurice Stokes", "stokema01", false], ["Brian Taylor", "taylobr01", false], ["Sebastian Telfair", "telfase01", false], ["LaSalle Thompson", "thompla01", false], ["Mychal Thompson", "thompmy01", false], ["Sedale Threatt", "threase01", false], ["Wayman Tisdale", "tisdawa01", false], ["Ronny Turiaf", "turiaro01", false], ["Andre Turner", "turnean01", false], ["Elston Turner", "turneel01", false], ["Melvin Turpin", "turpime01", false], ["Darnell Valentine", "valenda01", false], ["Dick Van Arsdale", "vanardi01", false], ["Loy Vaught", "vaughlo01", false], ["Jan Veselý", "veselja01", false], ["Jay Vincent", "vinceja01", false], ["Sam Vincent", "vincesa01", false], ["Jake Voskuhl", "voskuja01", false], ["Chet Walker", "walkech01", false], ["Darrell Walker", "walkeda01", false], ["Kenny Walker", "walkeke01", false], ["Neal Walk", "walkne01", false], ["Bobby Wanzer", "wanzebo01", false], ["Eric Washington", "washier01", false], ["Kermit Washington", "washike01", false], ["Slick Watts", "wattssl01", false], ["Clarence Weatherspoon", "weathcl01", false], ["Spud Webb", "webbsp01", false], ["Scott Wedman", "wedmasc01", false], ["Delonte West", "westde01", false], ["Doug West", "westdo01", false], ["Mark West", "westma01", false], ["Ennis Whatley", "whatlen01", false], ["Jo Jo White", "whitejo01", false], ["Chris Wilcox", "wilcoch01", false], ["Jamaal Wilkes", "wilkeja01", false], ["Alvin Williams", "willial02", false], ["Buck Williams", "willibu01", false], ["Eric Williams", "willier01", false], ["Freeman Williams", "willifr01", false], ["Gus Williams", "willigu01", false], ["Herb Williams", "willihe01", false], ["Hot Rod Williams", "williho01", false], ["Jerome Williams", "willije01", false], ["Micheal Williams", "willimi02", false], ["Monty Williams", "willimo01", false], ["Ray Williams", "willira01", false], ["Shelden Williams", "willish02", false], ["Brian Winters", "wintebr01", false], ["Mike Woodson", "woodsmi01", false], ["Orlando Woolridge", "woolror01", false], ["Antoine Wright", "wrighan01", false], ["George Yardley", "yardlge01", false], ["Sam Young", "youngsa01", false], ["Tariq Abdul-Wahad", "abdulta01", false], ["Courtney Alexander", "alexaco02", false], ["Malik Allen", "allenma01", false], ["John Amaechi", "amaecjo01", false], ["Pero Antić", "anticpe01", false], ["Isaac Austin", "austiis01", false], ["Gustavo Ayón", "ayongu01", false], ["Corey Benjamin", "benjaco01", false], ["Andray Blatche", "blatcan01", false], ["Calvin Booth", "boothca01", false], ["Chucky Brown", "brownch01", false], ["Kwame Brown", "brownkw01", false], ["Mark Bryant", "bryanma01", false], ["Rodney Buford", "buforro01", false], ["Jason Caffey", "caffeja01", false], ["Chris Carr", "carrch01", false], ["Calbert Cheaney", "cheanca01", false], ["Earl Clark", "clarkea01", false], ["Brian Cook", "cookbr01", false], ["Chris Crawford", "crawfch01", false], ["Vonteego Cummings", "cummivo01", false], ["Antonio Davis", "davisan01", false], ["Glen Davis", "davisgl01", false], ["Terry Davis", "daviste01", false], ["Andrew DeClercq", "declean01", false], ["Juan Dixon", "dixonju01", false], ["Michael Doleac", "doleami01", false], ["Predrag Drobnjak", "drobnpr01", false], ["Chris Dudley", "dudlech02", false], ["Francisco Elson", "elsonfr01", false], ["Melvin Ely", "elyme01", false], ["Jamie Feick", "feickja01", false], ["Marcus Fizer", "fizerma01", false], ["Jonny Flynn", "flynnjo01", false], ["Greg Foster", "fostegr01", false], ["Jeff Foster", "fosteje01", false], ["Lawrence Funderburke", "fundela01", false], ["Dan Gadzuric", "gadzuda01", false], ["Matt Geiger", "geigema01", false], ["Dion Glover", "glovedi01", false], ["Eddie Griffin", "griffed01", false], ["Tom Hammonds", "hammoto01", false], ["David Harrison", "harrida01", false], ["Othella Harrington", "harriot01", false], ["Jerome James", "jamesje01", false], ["Yi Jianlian", "jianlyi01", false], ["Ivan Johnson", "johnsiv01", false], ["Popeye Jones", "jonespo01", false], ["Travis Knight", "knightr01", false], ["Luc Longley", "longllu01", false], ["Todd MacCulloch", "maccuto01", false], ["Mark Madsen", "madsema01", false], ["Desmond Mason", "masonde01", false], ["Tony Massenburg", "masseto01", false], ["Rashad McCants", "mccanra01", false], ["Jeff McInnis", "mcinnje01", false], ["Stanislav Medvedenko", "medvest01", false], ["Ron Mercer", "mercero01", false], ["Chris Mihm", "mihmch01", false], ["Darko Miličić", "milicda01", false], ["Greg Minor", "minorgr01", false], ["Eric Montross", "montrer01", false], ["Hanno Möttölä", "mottoha01", false], ["Byron Mullens", "mulleby01", false], ["Lee Nailon", "nailole01", false], ["Tyrone Nesby", "nesbyty01", false], ["Michael Olowokandi", "olowomi01", false], ["Travis Outlaw", "outlatr01", false], ["Cherokee Parks", "parksch02", false], ["Will Perdue", "perduwi01", false], ["Johan Petro", "petrojo01", false], ["Scot Pollard", "pollasc01", false], ["Olden Polynice", "polynol01", false], ["Vitaly Potapenko", "potapvi01", false], ["Bryant Reeves", "reevebr01", false], ["J.R. Reid", "reidjr01", false], ["James Robinson", "robinja02", false], ["Malik Rose", "rosema01", false], ["Kareem Rush", "rushka01", false], ["Alexey Shved", "shvedal01", false], ["Dickey Simpkins", "simpkdi01", false], ["Reggie Slater", "slatere01", false], ["Craig Smith", "smithcr01", false], ["Kirk Snyder", "snydeki01", false], ["Darius Songaila", "songada01", false], ["Vladimir Stepania", "stepavl01", false], ["Michael Stewart", "stewami01", false], ["Salim Stoudamire", "stoudsa01", false], ["Derek Strong", "stronde01", false], ["Mike Sweetney", "sweetmi01", false], ["Stromile Swift", "swiftst01", false], ["Maurice Taylor", "tayloma01", false], ["Etan Thomas", "thomaet01", false], ["Kurt Thomas", "thomaku01", false], ["Tyrus Thomas", "thomaty01", false], ["Al Thornton", "thornal01", false], ["Robert Traylor", "traylro01", false], ["Gary Trent", "trentga01", false], ["Jake Tsakalidis", "tsakaja01", false], ["John Wallace", "wallajo01", false], ["Hakim Warrick", "warriha01", false], ["D.J. White", "whitedj01", false], ["Jahidi White", "whiteja01", false], ["Rodney White", "whitero02", false], ["Aaron Williams", "williaa01", false], ["Jayson Williams", "willija01", false], ["Kevin Willis", "willike02", false], ["Marcus Williams", "willima03", false]]; // [name, Basketball-Reference id, id guessed]
  const PAUSE_MS = 3500;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // The site quiets console.log (2026-10-29: nothing showed), so the lines go through a clean
  // console from a hidden frame, as warnings (shown even when Info is filtered out), and the tab's
  // title shows the progress.
  const frame = document.body.appendChild(Object.assign(document.createElement('iframe'), { hidden: true }));
  const log = (...a) => frame.contentWindow.console.warn(...a);
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
        log('  429: too many requests, waiting a minute');
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

  log(`BBRef headshots: ${list.length} players${TEST ? ' (TEST)' : ''}, about ${Math.ceil((list.length * PAUSE_MS * 2) / 60000)} min`);
  for (let i = 0; i < list.length; i++) {
    await one(list[i]);
    document.title = `${i + 1}/${list.length} headshots`;
    if ((i + 1) % 20 === 0 || i + 1 === list.length) log(`  ${i + 1}/${list.length} · ${Object.keys(photos).length} photos · ${missing.length} without one · ${errors.length} errors`);
  }
  log(`Done: ${Object.keys(photos).length} photos, ${missing.length} without one, ${errors.length} errors.`);
  if (TEST) {
    for (const [id, p] of Object.entries(photos)) log(`  ${p.name} (${id}) → page "${p.page}" · ${Math.round((p.jpg.length * 3) / 4 / 1024)} KB · ${p.src}`);
    for (const m of [...missing, ...errors]) log(`  ${m.join(' · ')}`);
  }
  save();
})();
