/**
 * The Draft Lottery drum (DraftLottery.tsx), drawn on a canvas.
 *
 * 2026-09-28, user's own call ("zastąpić mechanizm dźwigni ... na klasyczne kulki jak w normalnym
 * losowaniu irl"), shaped over several mockups: a glass sphere holds one white ball per CPU team and
 * one red ball for the player. Air kicks them around, then the balls come out one at a time and drop
 * into the draft order — the first ball out takes pick 1, the second pick 2 — and the pick the red
 * ball lands in is the player's slot. The slot itself is still decided by `createInitialTeams` in
 * draft.ts; the draw order is arranged so the red ball comes out exactly at that pick.
 *
 * Plain TypeScript with no React: the component creates it on mount and destroys it on unmount.
 */

export interface LotteryDrumOptions {
  slot: number;
  teamCount: number;
  /** Line under the title while the draw runs; `hot` while the player's ball is coming out. */
  onStatus: (text: string, hot: boolean) => void;
  /** Once, when the red ball lands (or `finish()` skips there). */
  onLanded: () => void;
}

export interface LotteryDrum {
  start: () => void;
  finish: () => void;
  setMuted: (muted: boolean) => void;
  destroy: () => void;
}

interface Ball {
  mine: boolean;
  x: number; y: number; vx: number; vy: number;
  out: boolean; landed: boolean; pulled: boolean;
  pick: number;
  trail: { x: number; y: number }[];
  // flight from the sphere to the board
  fx: number; fy: number; ft: number; dur: number;
  // the player's ball being drawn to the hatch
  px: number; py: number; pt: number;
}

interface Spark { x: number; y: number; vx: number; vy: number; life: number; white: boolean }
type Phase = 'idle' | 'drawing' | 'pull' | 'flight' | 'impact' | 'done';

const W = 400;
const MONO = "'JetBrains Mono', ui-monospace, Consolas, monospace";
// `.at-shell` accent (electric blue) and accent-2 (the "YOU" red), as canvas rgb triplets.
const ACC = '68,146,208';
const ACC2 = '217,74,96';
const INK = '#eef4fb';

const C = { x: 200, y: 200 };
const R = 132;
const BR = 13.5;
const FLOOR_Y = C.y + R + 20;
const HATCH = { x: C.x, y: C.y + R };
const TILE_W = 40, TILE_H = 40, TILE_GAP = 6, BOARD_Y = 420, PER_ROW = 8;

/** Wait before drawing pick n, seconds: the top picks, where the tension is, are slow; past them
 * the balls come out close together, several in the air at once (2026-09-28 playtest: pick #16
 * took ~10 s, now ~7). */
const gapBefore = (n: number) => (n <= 3 ? 0.7 : n <= 6 ? 0.4 : 0.22);

export function drumHeight(teamCount: number): number {
  return BOARD_Y + Math.ceil(teamCount / PER_ROW) * (TILE_H + 8) - 10;
}

function cellPos(n: number, teamCount: number) {
  const row = Math.floor((n - 1) / PER_ROW);
  const inRow = Math.min(PER_ROW, teamCount - row * PER_ROW);
  return {
    x: C.x - ((inRow - 1) / 2) * (TILE_W + TILE_GAP) + ((n - 1) % PER_ROW) * (TILE_W + TILE_GAP),
    y: BOARD_Y + row * (TILE_H + 8),
  };
}

function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---- sound: synthesized on the Draw click, no files ---------------------------------------------
interface Audio { ac: AudioContext; master: GainNode; airGain: GainNode; bp: BiquadFilterNode; noise: AudioBuffer }

function createAudio(): Audio | null {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    const ac = new Ctor();
    const master = ac.createGain(); master.gain.value = 0.8; master.connect(ac.destination);
    const len = ac.sampleRate * 2, noise = ac.createBuffer(1, len, ac.sampleRate), d = noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const air = ac.createBufferSource(); air.buffer = noise; air.loop = true;
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.6;
    const airGain = ac.createGain(); airGain.gain.value = 0;
    air.connect(bp).connect(airGain).connect(master); air.start();
    return { ac, master, airGain, bp, noise };
  } catch {
    return null;
  }
}

export function createLotteryDrum(canvas: HTMLCanvasElement, opts: LotteryDrumOptions): LotteryDrum {
  const ctx = canvas.getContext('2d');
  const { slot, teamCount } = opts;
  const H = drumHeight(teamCount);
  const S = canvas.width / W;
  const px = (v: number) => v * S;
  const reduced = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } })();

  let audio: Audio | null = null;
  let muted = false;
  const tone = (freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.3, slideTo?: number) => {
    if (!audio || muted) return;
    const { ac, master } = audio, t = ac.currentTime;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.02);
  };
  const noiseHit = (dur: number, vol: number, freq = 2000) => {
    if (!audio || muted) return;
    const { ac, master, noise } = audio, t = ac.currentTime;
    const s = ac.createBufferSource(); s.buffer = noise;
    const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
    const g = ac.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(master); s.start(t); s.stop(t + dur + 0.02);
  };
  const timers: number[] = [];
  const later = (fn: () => void, ms: number) => { timers.push(window.setTimeout(fn, ms)); };
  const sfx = {
    tick: (n: number) => { tone(420 + n * 38, 0.09, 'triangle', 0.18); noiseHit(0.04, 0.12, 5000); },
    heart: () => { tone(62, 0.22, 'sine', 0.55, 40); later(() => tone(58, 0.2, 'sine', 0.4, 38), 170); },
    whoosh: () => noiseHit(0.7, 0.25, 1400),
    boom: () => {
      tone(90, 0.9, 'sine', 0.7, 32); noiseHit(0.5, 0.45, 900);
      [523, 659, 784, 1046].forEach((f, i) => later(() => tone(f, 1.1, 'triangle', 0.08), 120 + i * 40));
    },
  };

  // ---- state ------------------------------------------------------------------------------------
  const balls: Ball[] = Array.from({ length: teamCount }, (_, i) => ({
    mine: i === 0,
    x: C.x - 78 + (i % 6) * 29 + Math.random() * 4, y: C.y + 30 + Math.floor(i / 6) * 26 - (teamCount > 18 ? 26 : 0),
    vx: 0, vy: 0, out: false, landed: false, pulled: false, pick: 0, trail: [],
    fx: 0, fy: 0, ft: 0, dur: 0, px: 0, py: 0, pt: 0,
  }));
  const mineBall = balls[0];
  const cpu = shuffle(balls.slice(1));
  const order = [...cpu.slice(0, slot - 1), mineBall, ...cpu.slice(slot - 1)];
  let bubbles: { x: number; y: number; r: number; v: number }[] = [];
  let sparks: Spark[] = [];
  let flying: Ball[] = [];
  let phase: Phase = 'idle';
  let mix = 0, nextPick = 1, nextAt = 0, vt = 0;
  let zoom = 1, shake = 0, flash = 0, heat = 0, slam = 0, heartAt = 0, lastHeart = 0;
  const focus = { x: W / 2, y: H / 2 };
  const ghost: { n: number; t: number; prev: number | null } = { n: 1, t: 1, prev: null };
  let landedFired = false;
  const inSphere = () => balls.filter((b) => !b.out);

  function physics(dt: number) {
    const live = inSphere();
    for (const b of live) {
      if (b.pulled) continue;
      b.vy += 900 * dt;
      if (mix > 0.02) {
        // Air comes in bursts, not as a steady lift: a steady upward force balanced gravity at one
        // height and the balls hovered there in a line (user-reported on the mockup).
        const dx = b.x - C.x, dy = b.y - C.y;
        if (Math.random() < mix * dt * (dy > R * 0.3 ? 5 : 1.5)) {
          b.vy -= 520 + Math.random() * 520 * (0.4 + (dy + R) / (2 * R));
          b.vx += (Math.random() - 0.5) * 520;
        }
        b.vx += (Math.random() - 0.5) * 1400 * mix * dt;
        b.vx += (-dy / R) * 220 * mix * dt;
        b.vy += (dx / R) * 220 * mix * dt;
      }
      b.vx *= 0.998; b.vy *= 0.998;
      b.x += b.vx * dt; b.y += b.vy * dt;
      const dx = b.x - C.x, dy = b.y - C.y, d = Math.hypot(dx, dy), lim = R - BR - 5;
      if (d > lim) {
        const nx = dx / d, ny = dy / d;
        b.x = C.x + nx * lim; b.y = C.y + ny * lim;
        const vn = b.vx * nx + b.vy * ny;
        if (vn > 0) { b.vx -= 1.6 * vn * nx; b.vy -= 1.6 * vn * ny; }
      }
    }
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j];
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
      if (d > 0 && d < BR * 2) {
        const nx = dx / d, ny = dy / d, o = (BR * 2 - d) / 2;
        if (!a.pulled) { a.x -= nx * o; a.y -= ny * o; }
        if (!b.pulled) { b.x += nx * o; b.y += ny * o; }
        const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rel < 0) { const k = -0.85 * rel; a.vx -= k * nx; a.vy -= k * ny; b.vx += k * nx; b.vy += k * ny; }
      }
    }
  }
  for (let i = 0; i < 300; i++) physics(1 / 120);

  // ---- flow -------------------------------------------------------------------------------------
  const setGhost = (n: number) => { if (ghost.n !== n) { ghost.prev = ghost.n; ghost.n = n; ghost.t = 0; } };
  function landed() {
    if (landedFired) return;
    landedFired = true;
    opts.onStatus('The balls have spoken.', false);
    opts.onLanded();
  }
  function drawPick() {
    const b = order[nextPick - 1];
    if (b.mine) {
      phase = 'pull'; b.pulled = true; b.px = b.x; b.py = b.y; b.pt = vt;
      opts.onStatus(`Pick #${nextPick}…`, true);
      heartAt = performance.now();
      return;
    }
    b.out = true; b.pick = nextPick; b.fx = b.x; b.fy = b.y; b.ft = vt; b.dur = 0.5; flying.push(b);
    opts.onStatus(`Pick #${nextPick} — another team.`, false);
    nextPick++;
    setGhost(nextPick);
    nextAt = vt + gapBefore(nextPick);
  }
  function launchMine() {
    const b = mineBall;
    b.pulled = false; b.out = true; b.pick = slot; b.fx = b.x; b.fy = b.y; b.ft = vt; b.dur = 0.55; flying.push(b);
    phase = 'flight';
    sfx.whoosh();
  }
  function impact() {
    phase = 'impact';
    shake = 12; flash = 1;
    const p = cellPos(slot, teamCount);
    for (let i = 0; i < 55; i++) {
      const a = Math.random() * Math.PI * 2, v = 80 + Math.random() * 300;
      sparks.push({ x: p.x, y: p.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120, life: 1, white: Math.random() < 0.25 });
    }
    sfx.boom();
    later(landed, 700);
  }
  function finish() {
    order.slice(0, slot).forEach((b, i) => {
      b.out = true; b.landed = true; b.pulled = false; b.pick = i + 1;
      const p = cellPos(b.pick, teamCount); b.x = p.x; b.y = p.y;
    });
    flying = []; sparks = [];
    phase = 'done'; mix = 0; zoom = 1; focus.x = W / 2; focus.y = H / 2; shake = 0; flash = 0; heat = 1; slam = 1;
    ghost.n = slot; ghost.t = 1; ghost.prev = null;
    landed();
  }
  function start() {
    if (phase !== 'idle') return;
    audio = audio ?? createAudio();
    if (audio && audio.ac.state === 'suspended') void audio.ac.resume();
    phase = 'drawing'; nextAt = vt + 0.9;
    opts.onStatus('Mixing…', false);
    sfx.whoosh();
  }

  // ---- drawing ----------------------------------------------------------------------------------
  function ballAt(c: CanvasRenderingContext2D, x: number, y: number, r: number, mine: boolean, alpha = 1, glow = 0) {
    c.save();
    c.translate(px(x), px(y));
    c.globalAlpha = alpha;
    if (glow > 0) {
      c.globalCompositeOperation = 'lighter';
      const g = c.createRadialGradient(0, 0, px(r * 0.6), 0, 0, px(r * 3));
      g.addColorStop(0, `rgba(${ACC2},${0.5 * glow})`); g.addColorStop(1, `rgba(${ACC2},0)`);
      c.fillStyle = g; c.beginPath(); c.arc(0, 0, px(r * 3), 0, Math.PI * 2); c.fill();
      c.globalCompositeOperation = 'source-over';
    }
    c.beginPath(); c.arc(0, 0, px(r), 0, Math.PI * 2);
    const body = c.createRadialGradient(px(-r * 0.35), px(-r * 0.4), px(r * 0.05), px(r * 0.1), px(r * 0.1), px(r * 1.05));
    if (mine) { body.addColorStop(0, '#ffc2cb'); body.addColorStop(0.35, '#e2566b'); body.addColorStop(0.85, '#8e1a2e'); body.addColorStop(1, '#4c0b17'); }
    else { body.addColorStop(0, '#ffffff'); body.addColorStop(0.5, '#dfe7f1'); body.addColorStop(0.9, '#7d8ea5'); body.addColorStop(1, '#4b5a6e'); }
    c.fillStyle = body; c.fill();
    c.strokeStyle = mine ? 'rgba(255,200,208,.5)' : `rgba(${ACC},.55)`; c.lineWidth = px(1.1);
    c.beginPath(); c.arc(0, 0, px(r - 0.6), Math.PI * 0.1, Math.PI * 0.75); c.stroke();
    if (mine) {
      c.fillStyle = '#fff';
      c.font = `800 ${px(r * 0.62)}px ${MONO}`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('YOU', 0, px(r * 0.06));
    }
    c.fillStyle = 'rgba(255,255,255,.9)';
    c.beginPath(); c.ellipse(px(-r * 0.36), px(-r * 0.44), px(r * 0.2), px(r * 0.11), -0.6, 0, Math.PI * 2); c.fill();
    c.restore();
  }

  function drawScene(c: CanvasRenderingContext2D, now: number) {
    const pulse = phase === 'pull' ? 0.5 + 0.5 * Math.sin(((now - heartAt) / 1000) * Math.PI * 2 * 1.4) : 0;
    const final = phase === 'impact' || phase === 'done';

    // fades out inside the canvas so its edge never shows against the shell
    const cone = c.createRadialGradient(px(C.x), px(C.y - 30), px(20), px(C.x), px(C.y), px(190));
    cone.addColorStop(0, `rgba(${heat > 0.5 ? ACC2 : ACC},${0.1 + 0.06 * mix + 0.1 * pulse + 0.06 * heat})`);
    cone.addColorStop(1, `rgba(${ACC},0)`);
    c.fillStyle = cone; c.fillRect(px(-60), px(-60), px(W + 120), px(H + 120));

    // the pick being drawn, large behind the sphere; the player's pick slams in red at the end
    const gt = Math.min(1, ghost.t), ge = 1 - Math.pow(1 - gt, 3);
    c.save();
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = `800 ${px(150)}px ${MONO}`;
    if (ghost.prev != null && gt < 1) {
      c.globalAlpha = (1 - ge) * 0.5;
      c.strokeStyle = `rgba(${ACC},.35)`; c.lineWidth = px(1.4);
      c.strokeText(`#${ghost.prev}`, px(C.x), px(C.y - 50 * ge));
    }
    c.globalAlpha = ge;
    if (final) {
      const se = 1 - Math.pow(1 - Math.min(1, slam), 4), sc = 1 + 0.5 * (1 - se);
      c.translate(px(C.x), px(C.y)); c.scale(sc, sc); c.translate(-px(C.x), -px(C.y));
      c.shadowColor = `rgba(${ACC2},.55)`; c.shadowBlur = px(26 * se);
      c.fillStyle = `rgba(${ACC2},.5)`; c.fillText(`#${ghost.n}`, px(C.x), px(C.y));
      c.shadowBlur = 0;
    }
    c.strokeStyle = final ? `rgba(${ACC2},.85)` : `rgba(${ACC},${phase === 'pull' ? 0.3 + 0.3 * pulse : 0.2})`;
    c.lineWidth = px(1.4);
    c.strokeText(`#${ghost.n}`, px(C.x), px(C.y + 50 * (1 - ge)));
    c.restore();
    c.fillStyle = final ? `rgb(${ACC2})` : 'rgb(72,88,109)';
    c.font = `700 ${px(10)}px ${MONO}`; c.textAlign = 'center';
    c.fillText(final ? 'Y O U R   P I C K' : phase === 'idle' ? 'F I R S T   P I C K' : 'N O W   D R A W I N G', px(C.x), px(C.y - R - 12));

    // floor glow and reflection
    const floor = c.createRadialGradient(px(C.x), px(FLOOR_Y), px(6), px(C.x), px(FLOOR_Y), px(160));
    floor.addColorStop(0, `rgba(${heat > 0.3 ? ACC2 : ACC},${0.2 + 0.22 * mix + 0.18 * heat})`); floor.addColorStop(1, `rgba(${ACC},0)`);
    c.fillStyle = floor; c.beginPath(); c.ellipse(px(C.x), px(FLOOR_Y), px(160), px(20), 0, 0, Math.PI * 2); c.fill();
    c.save();
    c.beginPath(); c.ellipse(px(C.x), px(FLOOR_Y + 3), px(140), px(16), 0, 0, Math.PI * 2); c.clip();
    c.translate(0, px(FLOOR_Y * 2 + 6)); c.scale(1, -1);
    for (const b of inSphere()) if (b.y > C.y + 40) ballAt(c, b.x, b.y, BR, b.mine, 0.16);
    c.restore();
    c.strokeStyle = `rgba(${ACC},.35)`; c.lineWidth = px(1);
    c.beginPath(); c.ellipse(px(C.x), px(FLOOR_Y - 6), px(56), px(8), 0, 0, Math.PI * 2); c.stroke();

    // sphere
    c.save();
    c.beginPath(); c.arc(px(C.x), px(C.y), px(R), 0, Math.PI * 2);
    const glass = c.createRadialGradient(px(C.x - 50), px(C.y - 60), px(10), px(C.x), px(C.y), px(R));
    glass.addColorStop(0, 'rgba(120,180,230,.08)'); glass.addColorStop(0.75, 'rgba(29,66,138,.16)'); glass.addColorStop(1, `rgba(${ACC},.3)`);
    c.fillStyle = glass; c.fill();
    c.clip();
    if (!mineBall.out) {
      c.globalCompositeOperation = 'lighter';
      const l = c.createRadialGradient(px(mineBall.x), px(mineBall.y), 0, px(mineBall.x), px(mineBall.y), px(105));
      l.addColorStop(0, `rgba(${ACC2},${0.2 + 0.25 * pulse})`); l.addColorStop(1, `rgba(${ACC2},0)`);
      c.fillStyle = l; c.fillRect(px(C.x - R), px(C.y - R), px(2 * R), px(2 * R));
      c.globalCompositeOperation = 'source-over';
    }
    c.fillStyle = 'rgba(200,225,250,.35)';
    for (const b of bubbles) { c.beginPath(); c.arc(px(b.x), px(b.y), px(b.r), 0, Math.PI * 2); c.fill(); }
    const dimOthers = phase === 'pull' ? 0.45 : 1;
    for (const b of inSphere()) {
      if (b.mine) continue;
      b.trail.forEach((t, k) => {
        c.fillStyle = `rgba(200,225,250,${0.05 * (k + 1) * dimOthers})`;
        c.beginPath(); c.arc(px(t.x), px(t.y), px(BR * (0.45 + 0.08 * k)), 0, Math.PI * 2); c.fill();
      });
      ballAt(c, b.x, b.y, BR, false, dimOthers);
    }
    if (!mineBall.out) ballAt(c, mineBall.x, mineBall.y, BR * (phase === 'pull' ? 1 + 0.12 * pulse : 1), true, 1, 0.5 + 0.6 * pulse);
    c.restore();
    const rim = c.createRadialGradient(px(C.x), px(C.y), px(R * 0.82), px(C.x), px(C.y), px(R));
    rim.addColorStop(0, `rgba(${ACC},0)`); rim.addColorStop(1, `rgba(${ACC},.25)`);
    c.fillStyle = rim; c.beginPath(); c.arc(px(C.x), px(C.y), px(R), 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(160,200,235,.55)'; c.lineWidth = px(1.4);
    c.beginPath(); c.arc(px(C.x), px(C.y), px(R), 0, Math.PI * 2); c.stroke();
    c.lineCap = 'round';
    c.strokeStyle = 'rgba(255,255,255,.28)'; c.lineWidth = px(6);
    c.beginPath(); c.arc(px(C.x), px(C.y), px(R - 18), Math.PI * 1.12, Math.PI * 1.33); c.stroke();
    c.strokeStyle = 'rgba(255,255,255,.1)'; c.lineWidth = px(3);
    c.beginPath(); c.arc(px(C.x), px(C.y), px(R - 12), Math.PI * 0.08, Math.PI * 0.22); c.stroke();
    c.fillStyle = '#05070c'; c.beginPath(); c.roundRect(px(C.x - 20), px(HATCH.y - 5), px(40), px(10), px(5)); c.fill();
    c.strokeStyle = `rgba(${ACC},.5)`; c.lineWidth = px(1); c.stroke();

    // draft order, as the same pills the picks list uses
    c.fillStyle = 'rgb(127,150,179)'; c.font = `400 ${px(11)}px ${MONO}`; c.textAlign = 'center';
    c.fillText('Draft order', px(C.x), px(BOARD_Y - TILE_H / 2 - 12));
    for (let n = 1; n <= teamCount; n++) {
      const p = cellPos(n, teamCount);
      const taken = balls.find((b) => b.landed && b.pick === n);
      const isNext = (phase === 'drawing' && n === nextPick) || ((phase === 'pull' || phase === 'flight') && n === slot);
      const isMine = !!taken && taken.mine;
      c.beginPath(); c.roundRect(px(p.x - TILE_W / 2), px(p.y - TILE_H / 2), px(TILE_W), px(TILE_H), px(10));
      c.fillStyle = isMine ? `rgba(${ACC2},.16)` : '#0d151f';
      c.fill();
      if (isMine || isNext) {
        c.strokeStyle = isMine ? `rgb(${ACC2})` : `rgba(${phase === 'drawing' ? ACC : ACC2},${0.55 + 0.45 * Math.sin(now / 110)})`;
        c.lineWidth = px(1.5); c.stroke();
        if (isMine) { c.shadowColor = `rgba(${ACC2},.6)`; c.shadowBlur = px(16); c.stroke(); c.shadowBlur = 0; }
      }
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = `700 ${px(12.5)}px ${MONO}`;
      c.fillStyle = isMine ? `rgb(${ACC2})` : taken ? 'rgb(72,88,109)' : isNext ? INK : 'rgba(127,150,179,.8)';
      c.fillText(`#${n}`, px(p.x), px(isMine ? p.y + 11 : taken ? p.y + 10 : p.y));
      if (taken) ballAt(c, p.x, p.y - 6, isMine ? 9 : 7.5, isMine, isMine ? 1 : 0.5);
    }
    c.textBaseline = 'alphabetic';

    for (const b of flying) ballAt(c, b.x, b.y, b.mine ? BR * 1.12 : BR, b.mine, 1, b.mine ? 1.1 : 0);

    c.globalCompositeOperation = 'lighter';
    for (const s of sparks) {
      c.fillStyle = s.white ? `rgba(255,240,240,${s.life})` : `rgba(${ACC2},${s.life})`;
      c.beginPath(); c.arc(px(s.x), px(s.y), px(1.2 + 2 * s.life), 0, Math.PI * 2); c.fill();
    }
    c.globalCompositeOperation = 'source-over';
  }

  // ---- main loop --------------------------------------------------------------------------------
  let prev = performance.now(), acc = 0, raf = 0;
  function frame(now: number) {
    const dt = Math.min(0.05, (now - prev) / 1000); prev = now;
    vt += dt;

    if (phase === 'drawing') {
      mix = Math.min(1, mix + dt * 2.5);
      if (vt >= nextAt) drawPick();
    } else if (phase === 'pull') {
      mix = Math.max(0.25, mix - dt * 1.2);
      const b = mineBall, u = Math.min(1, (vt - b.pt) / 0.45), e = u * u * (3 - 2 * u);
      b.x = b.px + (HATCH.x - b.px) * e; b.y = b.py + (HATCH.y - BR - 6 - b.py) * e; b.vx = 0; b.vy = 0;
      if (now - lastHeart > 700) { sfx.heart(); lastHeart = now; }
      if (u >= 1) launchMine();
    } else mix = Math.max(0, mix - dt * 1.4);
    if (audio) { audio.airGain.gain.value = muted ? 0 : mix * 0.09; audio.bp.frequency.value = 600 + 900 * mix; }

    if (mix > 0.05 && Math.random() < mix * 0.7) bubbles.push({ x: C.x + (Math.random() - 0.5) * 160, y: C.y + R - 8, r: 0.8 + Math.random() * 2.2, v: 130 + Math.random() * 170 });
    for (const b of bubbles) { b.y -= b.v * dt; b.x += (Math.random() - 0.5) * 30 * dt; }
    bubbles = bubbles.filter((b) => b.y > C.y - R);
    for (const b of inSphere()) {
      if (Math.hypot(b.vx, b.vy) > 260) { b.trail.push({ x: b.x, y: b.y }); if (b.trail.length > 5) b.trail.shift(); }
      else if (b.trail.length) b.trail.shift();
    }

    for (const b of flying) {
      const u = Math.min(1, (vt - b.ft) / b.dur);
      const target = cellPos(b.pick, teamCount);
      if (u < 0.3) { const e = (u / 0.3) ** 2; b.x = b.fx + (HATCH.x - b.fx) * e; b.y = b.fy + (HATCH.y + 8 - b.fy) * e; }
      else {
        const e = 1 - (1 - (u - 0.3) / 0.7) ** 3;
        b.x = HATCH.x + (target.x - HATCH.x) * e;
        b.y = HATCH.y + 8 + (target.y - 6 - HATCH.y - 8) * e - Math.sin(Math.PI * e) * (b.mine ? 36 : 16);
      }
      if (u >= 1) {
        b.landed = true;
        if (b.mine) impact(); else sfx.tick(b.pick);
      }
    }
    flying = flying.filter((b) => !b.landed);

    const wantZoom = phase === 'pull' ? 1.05 : phase === 'flight' ? 1.12 : phase === 'impact' ? 1.03 : 1;
    const wantFocus = phase === 'pull' ? { x: C.x, y: C.y + 50 }
      : phase === 'flight' ? { x: (mineBall.x + C.x) / 2, y: (mineBall.y + HATCH.y) / 2 + 20 }
      : phase === 'impact' ? { x: C.x, y: C.y + 50 } : { x: W / 2, y: H / 2 };
    const k = Math.min(1, dt * 4);
    zoom += (wantZoom - zoom) * k;
    focus.x += (wantFocus.x - focus.x) * k; focus.y += (wantFocus.y - focus.y) * k;
    shake = Math.max(0, shake - dt * 30); flash = Math.max(0, flash - dt * 2.2);
    if (phase === 'impact') { heat = Math.min(1, heat + dt * 2); slam = Math.min(1, slam + dt * 2.4); setGhost(slot); }
    ghost.t += dt * 3;
    for (const s of sparks) { s.vy += 420 * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt * 1.1; }
    sparks = sparks.filter((s) => s.life > 0);

    acc += dt; while (acc > 1 / 120) { physics(1 / 120); acc -= 1 / 120; }

    if (ctx) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const sx = (Math.random() - 0.5) * shake, sy = (Math.random() - 0.5) * shake;
      ctx.setTransform(zoom, 0, 0, zoom, px(W / 2 + sx) - px(focus.x) * zoom, px(H / 2 + sy) - px(focus.y) * zoom);
      drawScene(ctx, now);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (flash > 0) { ctx.fillStyle = `rgba(255,225,230,${0.4 * flash})`; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  if (reduced) finish();

  return {
    start,
    finish: () => { if (phase !== 'done') finish(); },
    setMuted: (m) => { muted = m; if (audio) audio.master.gain.value = m ? 0 : 0.8; },
    destroy: () => {
      cancelAnimationFrame(raf);
      timers.forEach((t) => window.clearTimeout(t));
      if (audio) void audio.ac.close();
    },
  };
}
