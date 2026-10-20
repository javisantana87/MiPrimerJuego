'use strict';

(() => {
  // ---------------------------------------------------------------------------
  // Configuración
  // ---------------------------------------------------------------------------
  const W = 420;                 // ancho lógico del mundo
  const LAUNCH_SPEED = 600;      // velocidad al salir de una órbita (px/s)
  const PLAYER_R = 7;
  const CAPTURE_MARGIN = 8;      // margen extra para engancharse a una órbita
  const MAX_FLIGHT = 2.4;        // segundos máximos de vuelo libre
  const SAVE_KEY = 'orbita_save_v1';

  const SKINS = [
    { id: 'cometa', name: 'Cometa', color: '#7df9ff', price: 0 },
    { id: 'fenix', name: 'Fénix', color: '#ff7b3a', price: 50 },
    { id: 'acido', name: 'Ácido', color: '#b6ff3b', price: 120 },
    { id: 'nebulosa', name: 'Nebulosa', color: '#ff4fd8', price: 250 },
    { id: 'dorado', name: 'Dorado', color: '#ffd447', price: 500 },
    { id: 'arcoiris', name: 'Arcoíris', color: 'rainbow', price: 1000 },
  ];

  // ---------------------------------------------------------------------------
  // Utilidades
  // ---------------------------------------------------------------------------
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------------------
  // Guardado
  // ---------------------------------------------------------------------------
  const save = Object.assign(
    { best: 0, stars: 0, owned: ['cometa'], skin: 'cometa', sound: true, vibe: true, games: 0, seenHelp: false },
    (() => {
      try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch (e) { return {}; }
    })()
  );
  function persist() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* sin almacenamiento */ }
  }

  // ---------------------------------------------------------------------------
  // Audio (sintetizado, sin archivos)
  // ---------------------------------------------------------------------------
  let audioCtx = null;
  function ensureAudio() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  }
  function tone(freq, dur = 0.12, type = 'sine', vol = 0.15, slideTo = null, delay = 0) {
    if (!save.sound || !audioCtx) return;
    const t = audioCtx.currentTime + delay;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }
  const sfx = {
    jump: () => tone(320, 0.12, 'triangle', 0.12, 640),
    land: () => tone(520, 0.08, 'sine', 0.12),
    perfect: (combo) => {
      const base = 520 + Math.min(combo, 8) * 60;
      tone(base, 0.1, 'square', 0.06);
      tone(base * 1.5, 0.15, 'square', 0.06, null, 0.07);
    },
    star: () => tone(1200, 0.08, 'sine', 0.1, 1800),
    die: () => { tone(300, 0.5, 'sawtooth', 0.12, 40); tone(90, 0.6, 'sine', 0.2, 30); },
    record: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, 'triangle', 0.1, null, i * 0.1)),
    click: () => tone(660, 0.05, 'sine', 0.08),
  };
  function vibrate(ms) {
    if (save.vibe && navigator.vibrate) navigator.vibrate(ms);
  }

  // ---------------------------------------------------------------------------
  // Canvas
  // ---------------------------------------------------------------------------
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  let H = 800, scale = 1, dpr = 1;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    scale = rect.width / W;
    H = rect.height / scale;
  }
  window.addEventListener('resize', resize);
  resize();

  // Estrellas de fondo (parallax)
  const bgStars = Array.from({ length: 140 }, () => ({
    x: Math.random() * W,
    y: Math.random(),
    z: rand(0.1, 1),
    tw: Math.random() * Math.PI * 2,
  }));

  // ---------------------------------------------------------------------------
  // Estado del mundo
  // ---------------------------------------------------------------------------
  let state = 'menu'; // menu | ready | play | dead | paused
  let planets, pickups, asteroids, particles, floaters, player;
  let camY, voidY, score, runStars, combo, time, shake, lastIdx, flash;

  function planetColors() {
    const h = Math.floor(rand(0, 360));
    return { h, c1: `hsl(${h},85%,68%)`, c2: `hsl(${(h + 40) % 360},70%,35%)` };
  }

  function makePlanet(x, y, idx, r) {
    const level = idx;
    const col = planetColors();
    const p = {
      idx, baseX: x, x, y, r,
      R: r + 26 + Math.random() * 6,
      omega: 2.1 + Math.min(level * 0.035, 1.6) + rand(-0.15, 0.15),
      color: col,
      ring: Math.random() < 0.3,
      craters: Array.from({ length: 3 }, () => ({ a: rand(0, 6.28), d: rand(0.2, 0.6), s: rand(0.12, 0.25) })),
      rot: 0,
      move: false, amp: 0, mSpeed: 0, phase: 0,
    };
    if (level >= 15 && Math.random() < Math.min(0.15 + (level - 15) * 0.012, 0.55)) {
      p.move = true;
      p.amp = rand(35, 85);
      p.mSpeed = rand(0.8, 1.6);
      p.phase = rand(0, 6.28);
      p.baseX = clamp(x, p.R + p.amp + 6, W - p.R - p.amp - 6);
      p.x = p.baseX;
    }
    return p;
  }

  function addPlanet() {
    const last = planets[planets.length - 1];
    const idx = last.idx + 1;
    const gap = rand(190, 245) + Math.min(idx, 40) * 0.9;
    const r = clamp(rand(26, 42) - idx * 0.22, 17, 42);
    let x, tries = 0;
    do { x = rand(75, W - 75); tries++; } while (Math.abs(x - last.baseX) < 80 && tries < 20);
    const p = makePlanet(x, last.y - gap, idx, r);
    planets.push(p);

    // Estrellas entre planetas
    const n = idx < 3 ? 1 : Math.floor(rand(1, 4));
    const mx = (last.baseX + p.baseX) / 2, my = (last.y + p.y) / 2;
    for (let i = 0; i < n; i++) {
      pickups.push({
        x: clamp(mx + rand(-90, 90), 25, W - 25),
        y: my + rand(-35, 35),
        rot: rand(0, 6.28),
        alive: true,
      });
    }

    // Asteroides
    if (idx >= 8 && Math.random() < Math.min(0.25 + (idx - 8) * 0.015, 0.65)) {
      const dir = Math.random() < 0.5 ? -1 : 1;
      asteroids.push({
        x: rand(0, W),
        y: my,
        vx: dir * rand(55, 110 + Math.min(idx, 60)),
        r: rand(9, 14),
        rot: 0,
        spin: rand(-3, 3),
        pts: Array.from({ length: 8 }, () => rand(0.7, 1.15)),
      });
    }
  }

  function reset() {
    planets = []; pickups = []; asteroids = []; particles = []; floaters = [];
    const p0 = makePlanet(W / 2, H * 0.68, 0, 40);
    p0.omega = 2.0;
    planets.push(p0);
    for (let i = 0; i < 6; i++) addPlanet();
    player = {
      state: 'orbit', planet: p0, from: null,
      angle: -Math.PI / 2, dir: 1, orbitR: p0.R,
      x: 0, y: 0, vx: 0, vy: 0, flyT: 0, trail: [],
    };
    placeOnOrbit();
    camY = 0;
    voidY = H + 160;
    score = 0; runStars = 0; combo = 0; time = 0; shake = 0; lastIdx = 0; flash = 0;
    updateHud();
  }

  function placeOnOrbit() {
    const p = player.planet;
    player.x = p.x + Math.cos(player.angle) * player.orbitR;
    player.y = p.y + Math.sin(player.angle) * player.orbitR;
  }

  // ---------------------------------------------------------------------------
  // Acciones
  // ---------------------------------------------------------------------------
  function launch() {
    if (player.state !== 'orbit') return;
    const a = player.angle, d = player.dir;
    player.vx = -Math.sin(a) * d * LAUNCH_SPEED;
    player.vy = Math.cos(a) * d * LAUNCH_SPEED;
    player.from = player.planet;
    player.state = 'fly';
    player.flyT = 0;
    burst(player.x, player.y, 8, skinColor(), 120);
    sfx.jump();
  }

  function capture(p) {
    const dx = player.x - p.x, dy = player.y - p.y;
    const cross = dx * player.vy - dy * player.vx;
    const speed = Math.hypot(player.vx, player.vy) || 1;
    const closest = Math.abs(cross) / speed;      // distancia mínima de la trayectoria al centro
    player.state = 'orbit';
    player.planet = p;
    player.dir = cross > 0 ? 1 : -1;
    player.angle = Math.atan2(dy, dx);
    player.orbitR = Math.hypot(dx, dy);

    if (p.idx > lastIdx) {
      const perfect = closest < p.r * 0.85;
      let pts = 1;
      if (perfect) {
        combo++;
        pts += Math.min(combo, 5);
        addFloater(p.x, p.y - p.R - 18, combo > 1 ? `¡PERFECTO! x${combo}` : '¡PERFECTO!', '#ffd447');
        sfx.perfect(combo);
        flash = 0.25;
        vibrate(25);
        burst(p.x, p.y, 22, p.color.c1, 220);
      } else {
        combo = 0;
        sfx.land();
        vibrate(10);
        burst(player.x, player.y, 10, p.color.c1, 140);
      }
      // Si se salta varios planetas de golpe, cuentan todos
      score += pts + (p.idx - lastIdx - 1);
      lastIdx = p.idx;
      addFloater(player.x, player.y - 20, `+${pts}`, '#ffffff');
      updateHud();
    } else {
      sfx.land();
    }
  }

  function die(reason) {
    if (state !== 'play') return;
    state = 'dead';
    player.state = 'dead';
    shake = 0.5;
    burst(player.x, player.y, 40, skinColor(), 320);
    sfx.die();
    vibrate([60, 40, 120]);

    save.games++;
    save.stars += runStars;
    const isRecord = score > save.best;
    if (isRecord) save.best = score;
    persist();

    setTimeout(() => {
      $('over-title').textContent = {
        void: '¡Te tragó el vacío!',
        asteroid: '¡Asteroide!',
        lost: '¡Perdido en el espacio!',
      }[reason] || '¡Fin!';
      $('over-score').textContent = score;
      $('over-best').textContent = save.best;
      $('over-stars').textContent = runStars;
      $('over-record').classList.toggle('hidden', !isRecord);
      if (isRecord && score > 0) sfx.record();
      show('over');
      $('hud').classList.add('hidden');
    }, 900);
  }

  // ---------------------------------------------------------------------------
  // Efectos
  // ---------------------------------------------------------------------------
  function burst(x, y, n, color, spd) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = rand(0.3, 1) * spd;
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.4, 0.9), max: 0.9, color, size: rand(1.5, 3.5) });
    }
  }
  function addFloater(x, y, text, color) {
    floaters.push({ x, y, text, color, life: 1 });
  }
  function skinColor(t = time) {
    const s = SKINS.find((k) => k.id === save.skin) || SKINS[0];
    return s.color === 'rainbow' ? `hsl(${(t * 200) % 360},100%,65%)` : s.color;
  }

  // ---------------------------------------------------------------------------
  // Actualización
  // ---------------------------------------------------------------------------
  function update(dt) {
    time += dt;
    const playing = state === 'play';

    for (const p of planets) {
      if (p.move) p.x = p.baseX + Math.sin(time * p.mSpeed + p.phase) * p.amp;
      p.rot += dt * 0.3;
    }
    for (const a of asteroids) {
      a.x += a.vx * dt;
      a.rot += a.spin * dt;
      if (a.x < -30) a.x = W + 30;
      if (a.x > W + 30) a.x = -30;
    }
    for (const s of pickups) s.rot += dt * 2;

    // Jugador
    if (player.state === 'orbit') {
      const p = player.planet;
      player.orbitR += (p.R - player.orbitR) * Math.min(1, dt * 8);
      player.angle += player.dir * p.omega * dt;
      placeOnOrbit();
    } else if (player.state === 'fly') {
      player.x += player.vx * dt;
      player.y += player.vy * dt;
      player.flyT += dt;
      for (const p of planets) {
        if (p === player.from) continue;
        if (Math.hypot(player.x - p.x, player.y - p.y) < p.R + CAPTURE_MARGIN) { capture(p); break; }
      }
      if (player.state === 'fly' && playing) {
        if (player.x < -15 || player.x > W + 15 || player.y > camY + H + 30 ||
            player.y < camY - 250 || player.flyT > MAX_FLIGHT) die('lost');
      }
    }

    if (player.state !== 'dead') {
      player.trail.push({ x: player.x, y: player.y });
      if (player.trail.length > 18) player.trail.shift();
    }

    if (playing && player.state !== 'dead') {
      // Asteroides
      for (const a of asteroids) {
        if (Math.hypot(player.x - a.x, player.y - a.y) < a.r * 0.85 + PLAYER_R) { die('asteroid'); break; }
      }
      // Estrellas
      for (const s of pickups) {
        if (s.alive && Math.hypot(player.x - s.x, player.y - s.y) < 22) {
          s.alive = false;
          runStars++;
          sfx.star();
          burst(s.x, s.y, 8, '#ffd447', 100);
          updateHud();
        }
      }
      // El vacío sube
      const voidSpeed = 22 + Math.min(score * 1.6, 95);
      voidY -= voidSpeed * dt;
      voidY = Math.min(voidY, camY + H + 150);
      if (player.y > voidY - 2) die('void');
    }

    // Cámara: sigue al último planeta alcanzado (solo hacia arriba)
    if (player.state !== 'dead') {
      const target = player.planet.y - H * 0.66;
      if (target < camY) camY += (target - camY) * Math.min(1, dt * 3);
    }

    // Generar / limpiar mundo
    while (planets[planets.length - 1].y > camY - H) addPlanet();
    const cutoff = camY + H + 400;
    planets = planets.filter((p) => p.y < cutoff || p === player.planet);
    pickups = pickups.filter((s) => s.alive && s.y < cutoff);
    asteroids = asteroids.filter((a) => a.y < cutoff);

    // Partículas
    for (const pt of particles) {
      pt.x += pt.vx * dt; pt.y += pt.vy * dt;
      pt.vx *= 0.96; pt.vy *= 0.96;
      pt.life -= dt;
    }
    particles = particles.filter((pt) => pt.life > 0);
    for (const f of floaters) { f.y -= 40 * dt; f.life -= dt * 0.9; }
    floaters = floaters.filter((f) => f.life > 0);

    shake = Math.max(0, shake - dt);
    flash = Math.max(0, flash - dt);
  }

  // ---------------------------------------------------------------------------
  // Dibujado
  // ---------------------------------------------------------------------------
  function draw() {
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);

    // Fondo: el color cambia según la altura alcanzada
    const hue = (250 + score * 5) % 360;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, `hsl(${hue},55%,7%)`);
    g.addColorStop(1, `hsl(${(hue + 40) % 360},60%,14%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Estrellas de fondo
    for (const s of bgStars) {
      const sy = (((s.y * H - camY * s.z * 0.35) % H) + H) % H;
      const a = 0.35 + 0.45 * Math.abs(Math.sin(time * 1.5 + s.tw));
      ctx.fillStyle = `rgba(255,255,255,${a * s.z})`;
      ctx.fillRect(s.x, sy, s.z * 2, s.z * 2);
    }

    const sx = shake > 0 ? rand(-6, 6) * shake * 2 : 0;
    const sy = shake > 0 ? rand(-6, 6) * shake * 2 : 0;
    ctx.save();
    ctx.translate(sx, -camY + sy);

    // Planetas
    for (const p of planets) drawPlanet(p);

    // Estrellas recogibles
    for (const s of pickups) drawStar(s.x, s.y, 9, s.rot);

    // Asteroides
    for (const a of asteroids) {
      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.rotate(a.rot);
      ctx.beginPath();
      a.pts.forEach((m, i) => {
        const ang = (i / a.pts.length) * Math.PI * 2;
        const px = Math.cos(ang) * a.r * m, py = Math.sin(ang) * a.r * m;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      });
      ctx.closePath();
      ctx.fillStyle = '#8a7f8f';
      ctx.strokeStyle = '#ff6b6b';
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // Jugador
    if (player.state !== 'dead') drawPlayer();

    // Partículas
    for (const pt of particles) {
      ctx.globalAlpha = clamp(pt.life / pt.max, 0, 1);
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Textos flotantes
    ctx.textAlign = 'center';
    ctx.font = '900 18px system-ui, sans-serif';
    for (const f of floaters) {
      ctx.globalAlpha = clamp(f.life, 0, 1);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;

    drawVoid();
    ctx.restore();

    if (flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${flash * 0.5})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function drawPlanet(p) {
    const active = player.planet === p && player.state === 'orbit';
    // Órbita
    ctx.save();
    ctx.setLineDash([4, 8]);
    ctx.lineDashOffset = -time * 20;
    ctx.strokeStyle = active ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Halo
    const halo = ctx.createRadialGradient(p.x, p.y, p.r * 0.8, p.x, p.y, p.r * 1.8);
    halo.addColorStop(0, `hsla(${p.color.h},90%,60%,0.35)`);
    halo.addColorStop(1, `hsla(${p.color.h},90%,60%,0)`);
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * 1.8, 0, Math.PI * 2);
    ctx.fill();

    // Cuerpo
    const body = ctx.createRadialGradient(p.x - p.r * 0.4, p.y - p.r * 0.4, p.r * 0.1, p.x, p.y, p.r);
    body.addColorStop(0, p.color.c1);
    body.addColorStop(1, p.color.c2);
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();

    // Cráteres
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    for (const c of p.craters) {
      const a = c.a + p.rot;
      ctx.beginPath();
      ctx.arc(p.x + Math.cos(a) * p.r * c.d, p.y + Math.sin(a) * p.r * c.d, p.r * c.s, 0, Math.PI * 2);
      ctx.fill();
    }

    // Anillo
    if (p.ring) {
      ctx.strokeStyle = `hsla(${(p.color.h + 180) % 360},80%,75%,0.7)`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.r * 1.5, p.r * 0.4, -0.35, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Indicador de planeta en movimiento
    if (p.move) {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '700 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('◀ ▶', p.x, p.y + 4);
    }
  }

  function drawStar(x, y, r, rot) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.shadowColor = '#ffd447';
    ctx.shadowBlur = 12;
    ctx.fillStyle = '#ffd447';
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const rr = i % 2 ? r * 0.45 : r;
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawPlayer() {
    const col = skinColor();
    // Estela
    for (let i = 0; i < player.trail.length; i++) {
      const t = player.trail[i];
      const k = i / player.trail.length;
      ctx.globalAlpha = k * 0.6;
      ctx.fillStyle = save.skin === 'arcoiris' ? skinColor(time - (player.trail.length - i) * 0.03) : col;
      ctx.beginPath();
      ctx.arc(t.x, t.y, PLAYER_R * k, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // Guía de dirección mientras orbita
    if (player.state === 'orbit' && (state === 'ready' || state === 'play')) {
      const a = player.angle, d = player.dir;
      const tx = -Math.sin(a) * d, ty = Math.cos(a) * d;
      const guide = state === 'ready' || score < 3 ? 90 : 34;
      const lg = ctx.createLinearGradient(player.x, player.y, player.x + tx * guide, player.y + ty * guide);
      lg.addColorStop(0, 'rgba(255,255,255,0.5)');
      lg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.strokeStyle = lg;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(player.x, player.y);
      ctx.lineTo(player.x + tx * guide, player.y + ty * guide);
      ctx.stroke();
    }
    ctx.shadowColor = col;
    ctx.shadowBlur = 18;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(player.x, player.y, PLAYER_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(player.x, player.y, PLAYER_R * 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  function drawVoid() {
    const top = voidY;
    if (top > camY + H + 60) return;
    const g = ctx.createLinearGradient(0, top - 70, 0, top + 40);
    g.addColorStop(0, 'rgba(255,40,120,0)');
    g.addColorStop(0.6, 'rgba(255,40,120,0.35)');
    g.addColorStop(1, 'rgba(40,0,40,0.95)');
    ctx.fillStyle = g;
    ctx.fillRect(0, top - 70, W, 110);
    ctx.fillStyle = 'rgba(25,0,30,0.97)';
    ctx.beginPath();
    ctx.moveTo(0, camY + H + 50);
    for (let x = 0; x <= W; x += 14) {
      ctx.lineTo(x, top + Math.sin(x * 0.05 + time * 3) * 5 + Math.sin(x * 0.13 - time * 2) * 3);
    }
    ctx.lineTo(W, camY + H + 50);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,60,150,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 14) {
      const y = top + Math.sin(x * 0.05 + time * 3) * 5 + Math.sin(x * 0.13 - time * 2) * 3;
      x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
  }

  // ---------------------------------------------------------------------------
  // Bucle principal
  // ---------------------------------------------------------------------------
  let lastT = performance.now();
  function frame(now) {
    const dt = Math.min((now - lastT) / 1000, 1 / 30);
    lastT = now;
    if (state !== 'paused') update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------------------
  // Interfaz
  // ---------------------------------------------------------------------------
  const screens = ['menu', 'help', 'skins', 'pause', 'over'];
  function show(id) {
    screens.forEach((s) => $(s).classList.toggle('hidden', s !== id));
  }
  function updateHud() {
    $('hud-score').textContent = score;
    $('hud-stars').textContent = runStars;
  }
  function refreshMenu() {
    $('menu-best').textContent = save.best;
    $('menu-stars').textContent = save.stars;
    $('btn-sound').classList.toggle('off', !save.sound);
    $('btn-sound').textContent = save.sound ? '🔊' : '🔈';
    $('btn-vibe').classList.toggle('off', !save.vibe);
  }
  let toastTimer = null;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 1600);
  }

  function goMenu() {
    state = 'menu';
    reset();
    refreshMenu();
    show('menu');
    $('hud').classList.add('hidden');
    $('hint').classList.add('hidden');
  }

  function startGame() {
    ensureAudio();
    sfx.click();
    reset();
    state = 'ready';
    show(null);
    $('hud').classList.remove('hidden');
    $('hint').classList.remove('hidden');
  }

  function pauseGame() {
    if (state !== 'play' && state !== 'ready') return;
    pausedFrom = state;
    state = 'paused';
    show('pause');
  }
  let pausedFrom = 'play';
  function resumeGame() {
    if (state !== 'paused') return;
    state = pausedFrom;
    show(null);
  }

  function renderSkins() {
    $('skins-stars').textContent = save.stars;
    const grid = $('skins-grid');
    grid.innerHTML = '';
    for (const s of SKINS) {
      const owned = save.owned.includes(s.id);
      const b = document.createElement('button');
      b.className = 'skin' + (save.skin === s.id ? ' selected' : '') + (owned ? '' : ' locked');
      const bg = s.color === 'rainbow'
        ? 'conic-gradient(red, orange, yellow, lime, cyan, blue, magenta, red)'
        : `radial-gradient(circle, #fff 0 30%, ${s.color} 32%)`;
      b.innerHTML = `<div class="skin-dot" style="background:${bg};box-shadow:0 0 14px ${s.color === 'rainbow' ? '#fff' : s.color}"></div>
        <div class="skin-name">${s.name}</div>
        <div class="skin-price">${owned ? (save.skin === s.id ? 'EN USO' : 'Usar') : '<span class="star-icon">★</span> ' + s.price}</div>`;
      b.addEventListener('click', () => {
        if (owned) {
          save.skin = s.id;
          sfx.click();
        } else if (save.stars >= s.price) {
          save.stars -= s.price;
          save.owned.push(s.id);
          save.skin = s.id;
          sfx.record();
          toast(`¡${s.name} desbloqueado!`);
        } else {
          toast(`Te faltan ${s.price - save.stars} ★`);
          tone(200, 0.15, 'square', 0.06);
          return;
        }
        persist();
        renderSkins();
      });
      grid.appendChild(b);
    }
  }

  // Entrada: tocar / clic / espacio
  function onTap(e) {
    if (e) e.preventDefault();
    ensureAudio();
    if (state === 'ready') {
      state = 'play';
      $('hint').classList.add('hidden');
      launch();
    } else if (state === 'play') {
      launch();
    }
  }
  canvas.addEventListener('pointerdown', onTap);
  $('hint').addEventListener('pointerdown', onTap);
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'Enter') {
      if (state === 'ready' || state === 'play') onTap(e);
      else if (state === 'dead' && !$('over').classList.contains('hidden')) startGame();
      else if (state === 'menu' && !$('menu').classList.contains('hidden')) startGame();
    } else if (e.code === 'Escape' || e.code === 'KeyP') {
      state === 'paused' ? resumeGame() : pauseGame();
    }
  });

  $('btn-play').addEventListener('click', () => {
    if (!save.seenHelp) {
      save.seenHelp = true;
      persist();
      ensureAudio();
      show('help');
      helpThenPlay = true;
      return;
    }
    startGame();
  });
  let helpThenPlay = false;
  $('btn-retry').addEventListener('click', startGame);
  $('btn-menu').addEventListener('click', () => { sfx.click(); goMenu(); });
  $('btn-skins').addEventListener('click', () => { ensureAudio(); sfx.click(); renderSkins(); show('skins'); });
  $('btn-help').addEventListener('click', () => { ensureAudio(); sfx.click(); show('help'); });
  $('btn-pause').addEventListener('click', (e) => { e.stopPropagation(); pauseGame(); });
  $('btn-pause').addEventListener('pointerdown', (e) => e.stopPropagation());
  $('btn-resume').addEventListener('click', resumeGame);
  $('btn-quit').addEventListener('click', goMenu);
  $('btn-sound').addEventListener('click', () => {
    save.sound = !save.sound; persist(); ensureAudio(); sfx.click(); refreshMenu();
  });
  $('btn-vibe').addEventListener('click', () => {
    save.vibe = !save.vibe; persist(); vibrate(30); refreshMenu();
  });
  document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => {
    sfx.click();
    if (helpThenPlay) { helpThenPlay = false; startGame(); return; }
    refreshMenu();
    show('menu');
  }));

  // Pausar al cambiar de app / pestaña
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pauseGame();
    lastT = performance.now();
  });

  // Botón "atrás" de Android (Capacitor)
  const capApp = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
  if (capApp) {
    capApp.addListener('backButton', () => {
      if (state === 'play' || state === 'ready') pauseGame();
      else if (state === 'paused') resumeGame();
      else if (state === 'menu' && $('menu').classList.contains('hidden')) { refreshMenu(); show('menu'); }
      else if (state === 'dead') goMenu();
      else capApp.exitApp();
    });
  }

  // Gancho para pruebas automáticas (solo con ?debug en la URL)
  if (/[?&]debug/.test(location.search)) {
    window.__orbita = () => ({ state, score, runStars, player, planets, lastIdx });
  }

  // Arranque
  goMenu();
  requestAnimationFrame(frame);
})();
