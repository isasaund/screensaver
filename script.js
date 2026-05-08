(() => {
  const canvas = document.getElementById("bubble-canvas");
  if (!canvas) return;

  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return;

  const prefersReducedMotion =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let dpr = 1;
  let w = 0;
  let h = 0;

  const mouse = {
    x: 0,
    y: 0,
    active: false,
    lastMoveAt: 0,
  };

  const bubbles = [];
  const particles = [];
  /** Water droplets that snap off the film when a bubble pops */
  const droplets = [];
  /** Tiny bubbles that follow the cursor */
  const trail = [];
  let lastTrailSpawnAt = 0;
  let bubbleCount = 0;
  /** Next scheduled spontaneous pop (ms); 0 = uninitialized until first animation frame */
  let nextSpontaneousPopAt = 0;

  function rand(min, max) {
    return Math.random() * (max - min) + min;
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    w = Math.max(1, Math.floor(rect.width));
    h = Math.max(1, Math.floor(rect.height));

    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // density scales with area, capped for performance
    const target = clamp(Math.floor((w * h) / 14000), 36, 115);
    bubbleCount = prefersReducedMotion ? Math.min(target, 50) : target;

    // grow/shrink bubble array
    while (bubbles.length < bubbleCount) bubbles.push(makeBubble(true));
    while (bubbles.length > bubbleCount) bubbles.pop();
    nextSpontaneousPopAt = 0;
  }

  function makeBubble(spawnAnywhere = false) {
    // Bias toward small bubbles with occasional large ones for natural variety
    const u = Math.random();
    const r = Math.random() < 0.025
      ? rand(70, 95) // very rare jumbo
      : 5 + Math.pow(u, 2.4) * 55; // 5 → 60 with stronger skew toward small
    const x = spawnAnywhere ? rand(0, w) : rand(-r, w + r);
    const y = spawnAnywhere ? rand(0, h) : rand(-r, h + r);

    // Larger bubbles drift slower; smaller ones zip a bit
    const sizeT = clamp((r - 5) / 90, 0, 1);
    const speed = rand(0.12, 0.55) * (1.25 - 0.55 * sizeT);
    const angle = rand(0, Math.PI * 2);

    // Iridescent soap-film palette: each bubble gets a random base hue and two
    // sibling hues spaced around the color wheel so we read pink/green/accent
    // bands like real thin-film interference.
    const baseHue = rand(0, 360);
    const pinkHue = (baseHue + rand(-12, 12) + 360) % 360;
    const greenHue = (baseHue + rand(110, 140)) % 360;
    const accentHue = (baseHue + rand(220, 260)) % 360;
    const strength = rand(0.55, 1); // scales highlight intensity slightly per bubble

    return {
      x,
      y,
      r,
      baseR: r,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      pinkHue,
      greenHue,
      accentHue,
      strength,
      wobble: rand(0, Math.PI * 2),
      wobbleSpeed: rand(0.002, 0.01),
      popping: false,
      popStartAt: 0,
      lastPopAt: -Infinity,
    };
  }

  function easeOutCubic(x) {
    return 1 - Math.pow(1 - x, 3);
  }

  function spawnPopParticles(x, y, b) {
    const count = Math.floor(10 + b.baseR * 0.22);
    for (let i = 0; i < count; i++) {
      const ang = rand(0, Math.PI * 2);
      const spd = rand(0.6, 3.2) * (0.6 + b.strength * 0.6);
      const hueRoll = Math.random();
      const hue =
        hueRoll < 0.4 ? b.pinkHue : hueRoll < 0.8 ? b.greenHue : b.accentHue;
      particles.push({
        x,
        y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        r: rand(0.7, 2.2),
        hue,
        life: rand(260, 520),
        bornAt: performance.now(),
      });
    }
  }

  function spawnWaterDroplets(x, y, b, now) {
    const n = Math.floor(5 + b.baseR * 0.16);
    const surface = b.baseR * 0.92;
    for (let i = 0; i < n; i++) {
      const ang = rand(0, Math.PI * 2);
      const edgeX = x + Math.cos(ang) * surface;
      const edgeY = y + Math.sin(ang) * surface;
      const jitter = rand(-0.35, 0.35);
      const spd = rand(2.2, 6.2) * (0.72 + b.strength * 0.35);
      droplets.push({
        x: edgeX + rand(-1.5, 1.5),
        y: edgeY + rand(-1.5, 1.5),
        vx: Math.cos(ang + jitter) * spd,
        vy: Math.sin(ang + jitter) * spd + rand(-1.4, 0.6),
        r: rand(1.1, 3.4),
        life: rand(400, 780),
        bornAt: now,
      });
    }
  }

  function drawWaterDroplet(p, k) {
    const r = p.r * (0.78 + 0.22 * k);
    const hx = p.x - r * 0.38;
    const hy = p.y - r * 0.42;

    ctx.globalCompositeOperation = "source-over";
    const body = ctx.createRadialGradient(hx, hy, r * 0.08, p.x, p.y + r * 0.12, r);
    body.addColorStop(0, `rgba(255,255,255,${0.88 * k})`);
    body.addColorStop(0.25, `rgba(210,235,255,${0.72 * k})`);
    body.addColorStop(0.55, `rgba(120,165,205,${0.55 * k})`);
    body.addColorStop(0.85, `rgba(55,95,140,${0.42 * k})`);
    body.addColorStop(1, `rgba(25,45,70,${0.15 * k})`);

    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = `rgba(255,255,255,${0.45 * k})`;
    ctx.beginPath();
    ctx.arc(p.x - r * 0.32, p.y - r * 0.38, Math.max(0.35, r * 0.28), 0, Math.PI * 2);
    ctx.fill();

    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = `rgba(180,215,245,${0.35 * k})`;
    ctx.lineWidth = Math.max(0.4, r * 0.12);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 0.88, 0.3, Math.PI * 1.1);
    ctx.stroke();
  }

  function spawnTrailBubble(x, y, now) {
    const r = rand(1.4, 4.2);
    const ang = rand(-Math.PI * 0.65, -Math.PI * 0.35); // mostly upward
    const spd = rand(0.18, 0.55);
    const baseHue = rand(0, 360);
    trail.push({
      x: x + rand(-3, 3),
      y: y + rand(-2, 2),
      vx: Math.cos(ang) * spd + rand(-0.08, 0.08),
      vy: Math.sin(ang) * spd,
      r,
      baseR: r,
      pinkHue: (baseHue + rand(-12, 12) + 360) % 360,
      greenHue: (baseHue + rand(110, 140)) % 360,
      accentHue: (baseHue + rand(220, 260)) % 360,
      wobble: rand(0, Math.PI * 2),
      wobbleSpeed: rand(0.02, 0.06),
      life: rand(900, 1700),
      bornAt: now,
    });
  }

  function drawTrailBubble(b, k) {
    // k goes 1 → 0 over the bubble's life
    const a = Math.min(1, k * 1.4);
    const r = b.r;

    ctx.globalCompositeOperation = "screen";

    // soft body sheen
    const body = ctx.createRadialGradient(
      b.x - r * 0.35,
      b.y - r * 0.4,
      0,
      b.x,
      b.y,
      r
    );
    body.addColorStop(0, `rgba(255,255,255,${0.55 * a})`);
    body.addColorStop(0.55, `hsla(${b.pinkHue}, 96%, 88%, ${0.18 * a})`);
    body.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
    ctx.fill();

    // thin film rim
    ctx.lineWidth = Math.max(0.5, r * 0.18);
    const rim = ctx.createLinearGradient(
      b.x - r,
      b.y - r,
      b.x + r,
      b.y + r
    );
    rim.addColorStop(0, `hsla(${b.pinkHue}, 96%, 82%, ${0.55 * a})`);
    rim.addColorStop(0.55, `hsla(${b.accentHue}, 94%, 80%, ${0.45 * a})`);
    rim.addColorStop(1, `hsla(${b.greenHue}, 92%, 78%, ${0.5 * a})`);
    ctx.strokeStyle = rim;
    ctx.beginPath();
    ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
    ctx.stroke();

    // pin glint
    ctx.fillStyle = `rgba(255,255,255,${0.7 * a})`;
    ctx.beginPath();
    ctx.arc(b.x - r * 0.4, b.y - r * 0.45, Math.max(0.4, r * 0.18), 0, Math.PI * 2);
    ctx.fill();

    ctx.globalCompositeOperation = "source-over";
  }

  function triggerPop(b, now) {
    b.popping = true;
    b.popStartAt = now;
    b.lastPopAt = now;
  }

  function drawBubble(b, t) {
    const film = 0.102 + 0.088 * b.strength; // stronger film read + depth

    // Dark interior: offset radial reads as a hollow sphere (light upper-left)
    ctx.globalCompositeOperation = "source-over";
    const litX = b.x - b.r * 0.24;
    const litY = b.y - b.r * 0.28;
    const body = ctx.createRadialGradient(
      litX,
      litY,
      b.r * 0.05,
      b.x + b.r * 0.07,
      b.y + b.r * 0.06,
      b.r * 1.04
    );
    body.addColorStop(0, `rgba(0,0,0,${0.11 * film})`);
    body.addColorStop(0.35, `rgba(0,0,0,${0.065 * film})`);
    body.addColorStop(0.58, `rgba(0,0,0,${0.095 * film})`);
    body.addColorStop(0.82, `rgba(0,0,0,${0.20 * film})`);
    body.addColorStop(0.94, `rgba(0,0,0,${0.14 * film})`);
    body.addColorStop(1, "rgba(0,0,0,0)");
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fillStyle = body;
    ctx.fill();

    // Shadow hemisphere (lower-right) — sells roundness without killing transparency
    ctx.save();
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.clip();
    const shX = b.x + b.r * 0.34;
    const shY = b.y + b.r * 0.36;
    const shadowBlob = ctx.createRadialGradient(
      shX,
      shY,
      b.r * 0.05,
      shX,
      shY,
      b.r * 0.92
    );
    shadowBlob.addColorStop(0, `rgba(10,12,32,${0.28 * film})`);
    shadowBlob.addColorStop(0.4, `rgba(6,8,20,${0.13 * film})`);
    shadowBlob.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = shadowBlob;
    ctx.fillRect(b.x - b.r, b.y - b.r, b.r * 2, b.r * 2);
    ctx.restore();

    // Translucent interior sheen (subtle white + pink glaze, still mostly empty)
    ctx.globalCompositeOperation = "screen";
    ctx.save();
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.clip();
    const fillSheen = ctx.createRadialGradient(
      b.x - b.r * 0.34,
      b.y - b.r * 0.38,
      0,
      b.x - b.r * 0.04,
      b.y - b.r * 0.06,
      b.r * 0.98
    );
    const fillA = 0.175 * film * b.strength;
    fillSheen.addColorStop(0, `rgba(255,255,255,${fillA})`);
    fillSheen.addColorStop(0.22, `hsla(${b.pinkHue}, 98%, 90%, ${fillA * 0.7})`);
    fillSheen.addColorStop(0.5, `hsla(${b.accentHue}, 96%, 86%, ${fillA * 0.4})`);
    fillSheen.addColorStop(0.78, `hsla(${b.greenHue}, 92%, 84%, ${fillA * 0.18})`);
    fillSheen.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = fillSheen;
    ctx.fillRect(b.x - b.r, b.y - b.r, b.r * 2, b.r * 2);
    ctx.restore();

    // Broad soft highlight (secondary shine layer)
    ctx.save();
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.clip();
    ctx.globalCompositeOperation = "screen";
    const broad = ctx.createRadialGradient(
      b.x - b.r * 0.48,
      b.y - b.r * 0.52,
      b.r * 0.08,
      b.x - b.r * 0.12,
      b.y - b.r * 0.14,
      b.r * 0.72
    );
    const broadA = 0.09 * film * b.strength;
    broad.addColorStop(0, `rgba(255,255,255,${broadA * 1.4})`);
    broad.addColorStop(0.3, `hsla(${b.accentHue}, 95%, 90%, ${broadA * 0.7})`);
    broad.addColorStop(0.7, `hsla(${b.pinkHue}, 95%, 88%, ${broadA * 0.25})`);
    broad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = broad;
    ctx.fillRect(b.x - b.r, b.y - b.r, b.r * 2, b.r * 2);
    ctx.restore();

    // Thin-film rim: pink -> accent -> green for a real iridescent band
    ctx.globalCompositeOperation = "screen";
    ctx.lineWidth = Math.max(1, b.r * 0.052);
    const rim = ctx.createLinearGradient(
      b.x - b.r,
      b.y - b.r,
      b.x + b.r,
      b.y + b.r
    );
    const rimA = 0.19 * b.strength;
    // Shortest signed deltas on a circle (prevents accidental long-path drift)
    const dh = ((b.greenHue - b.pinkHue + 540) % 360) - 180;
    const midHue = (b.pinkHue + dh * 0.5 + 360) % 360;
    rim.addColorStop(0, `hsla(${b.pinkHue}, 96%, 80%, ${rimA})`);
    rim.addColorStop(0.32, `hsla(${b.accentHue}, 94%, 78%, ${rimA * 0.85})`);
    rim.addColorStop(0.62, `hsla(${midHue}, 92%, 78%, ${rimA * 0.55})`);
    rim.addColorStop(1, `hsla(${b.greenHue}, 92%, 74%, ${rimA})`);
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.strokeStyle = rim;
    ctx.stroke();

    // Secondary rim pass (thin) — opposite direction, accent in the middle
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(0.6, b.r * 0.022);
    const rim2 = ctx.createLinearGradient(
      b.x + b.r,
      b.y - b.r * 0.2,
      b.x - b.r,
      b.y + b.r * 0.35
    );
    const rim2A = 0.13 * b.strength;
    rim2.addColorStop(0, `hsla(${b.greenHue}, 96%, 80%, ${rim2A})`);
    rim2.addColorStop(0.4, `hsla(${b.accentHue}, 96%, 80%, ${rim2A * 0.7})`);
    rim2.addColorStop(0.7, `hsla(${midHue}, 92%, 78%, ${rim2A * 0.4})`);
    rim2.addColorStop(1, `hsla(${b.pinkHue}, 95%, 82%, ${rim2A})`);
    ctx.strokeStyle = rim2;
    ctx.stroke();

    // Fresnel-style rim glow (glancing shine on the sphere silhouette)
    ctx.save();
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.clip();
    ctx.globalCompositeOperation = "screen";
    const fr = ctx.createRadialGradient(
      b.x,
      b.y,
      b.r * 0.72,
      b.x,
      b.y,
      b.r * 1.08
    );
    const frA = 0.26 * film * b.strength;
    fr.addColorStop(0, "rgba(255,255,255,0)");
    fr.addColorStop(0.55, "rgba(255,255,255,0)");
    fr.addColorStop(0.78, `rgba(255,252,255,${frA * 0.45})`);
    fr.addColorStop(0.92, `rgba(240,245,255,${frA})`);
    fr.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = fr;
    ctx.fillRect(b.x - b.r, b.y - b.r, b.r * 2, b.r * 2);
    ctx.restore();

    // Pink specular (primary highlight — slightly larger for spherical read)
    const pinkX = b.x - b.r * 0.37;
    const pinkY = b.y - b.r * 0.44;
    const pinkR = b.r * 0.34;
    const pinkG = ctx.createRadialGradient(pinkX, pinkY, 0, pinkX, pinkY, pinkR);
    pinkG.addColorStop(0, `hsla(${b.pinkHue}, 98%, 96%, ${0.48 * film * b.strength})`);
    pinkG.addColorStop(0.28, `hsla(${b.pinkHue}, 98%, 90%, ${0.28 * film * b.strength})`);
    pinkG.addColorStop(0.45, `hsla(${b.pinkHue}, 98%, 86%, ${0.16 * film * b.strength})`);
    pinkG.addColorStop(0.72, `hsla(${b.pinkHue}, 95%, 82%, ${0.05 * film * b.strength})`);
    pinkG.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = pinkG;
    ctx.beginPath();
    ctx.ellipse(pinkX, pinkY, pinkR * 0.95, pinkR * 0.62, -0.52, 0, Math.PI * 2);
    ctx.fill();

    // Pin glint (tight hot spot)
    ctx.globalCompositeOperation = "screen";
    const pinX = b.x - b.r * 0.44;
    const pinY = b.y - b.r * 0.48;
    const pinG = ctx.createRadialGradient(pinX, pinY, 0, pinX, pinY, b.r * 0.08);
    pinG.addColorStop(0, `rgba(255,255,255,${0.72 * film * b.strength})`);
    pinG.addColorStop(0.45, `rgba(255,252,255,${0.22 * film * b.strength})`);
    pinG.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = pinG;
    ctx.beginPath();
    ctx.arc(pinX, pinY, b.r * 0.075, 0, Math.PI * 2);
    ctx.fill();

    // Cool secondary specular (lower-right, glassy environment bounce)
    ctx.globalCompositeOperation = "screen";
    const sx = b.x + b.r * 0.38;
    const sy = b.y + b.r * 0.28;
    const sRad = b.r * 0.14;
    const spec2 = ctx.createRadialGradient(sx, sy, 0, sx, sy, sRad);
    spec2.addColorStop(0, `rgba(230,245,255,${0.42 * film * b.strength})`);
    spec2.addColorStop(0.4, `rgba(180,210,245,${0.18 * film * b.strength})`);
    spec2.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = spec2;
    ctx.beginPath();
    ctx.ellipse(sx, sy, sRad * 0.85, sRad * 0.65, 0.35, 0, Math.PI * 2);
    ctx.fill();

    // Soft pink grazing sheen (adds roundness without filling the interior)
    const grazingPink = ctx.createRadialGradient(
      b.x - b.r * 0.78,
      b.y + b.r * 0.05,
      0,
      b.x - b.r * 0.78,
      b.y + b.r * 0.05,
      b.r * 0.55
    );
    grazingPink.addColorStop(0, `hsla(${b.pinkHue}, 96%, 88%, ${0.16 * film * b.strength})`);
    grazingPink.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grazingPink;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();

    // Green counter-highlight (thin arc on opposite side)
    const gAng = 0.85 + Math.sin(t * 0.0007 + b.wobble) * 0.08;
    const gx = b.x + Math.cos(gAng) * b.r * 0.62;
    const gy = b.y + Math.sin(gAng) * b.r * 0.62;
    const gR = b.r * 0.19;
    const gg = ctx.createRadialGradient(gx, gy, 0, gx, gy, gR);
    gg.addColorStop(0, `hsla(${b.greenHue}, 96%, 86%, ${0.32 * film * b.strength})`);
    gg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gg;
    ctx.beginPath();
    ctx.arc(gx, gy, gR, 0, Math.PI * 2);
    ctx.fill();

    // Soft green grazing sheen (opposite limb)
    const grazingGreen = ctx.createRadialGradient(
      b.x + b.r * 0.82,
      b.y - b.r * 0.12,
      0,
      b.x + b.r * 0.82,
      b.y - b.r * 0.12,
      b.r * 0.62
    );
    grazingGreen.addColorStop(0, `hsla(${b.greenHue}, 94%, 84%, ${0.14 * film * b.strength})`);
    grazingGreen.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grazingGreen;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();

    // Tiny sparkle streak (tinted, not white)
    const s = (Math.sin(t * 0.001 + b.wobble) + 1) * 0.5; // 0..1
    if (s > 0.48) {
      ctx.globalCompositeOperation = "screen";
      const tint =
        s > 0.82 ? b.pinkHue : s > 0.65 ? b.accentHue : b.greenHue;
      ctx.strokeStyle = `hsla(${tint}, 98%, 92%, ${(s - 0.48) * 0.38 * film})`;
      ctx.lineWidth = 1.15;
      ctx.beginPath();
      ctx.moveTo(b.x + b.r * 0.15, b.y - b.r * 0.05);
      ctx.lineTo(b.x + b.r * 0.42, b.y - b.r * 0.2);
      ctx.stroke();
    }

    ctx.globalCompositeOperation = "source-over";
  }

  function step(t) {
    if (!prefersReducedMotion) requestAnimationFrame(step);

    // fade to black with a tiny trail for smooth motion
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fillRect(0, 0, w, h);

    // subtle vignette
    const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.8);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.35)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);

    const now = performance.now();
    const mouseActive = mouse.active && now - mouse.lastMoveAt < 600;

    // Stream of tiny bubbles trailing the cursor (wand hoop)
    if (mouseActive) {
      const interval = 22; // ms between emissions for a denser stream
      if (now - lastTrailSpawnAt >= interval) {
        const r = Math.random();
        const burst = r < 0.55 ? 2 : r < 0.9 ? 3 : 4;
        for (let i = 0; i < burst; i++) spawnTrailBubble(mouse.x, mouse.y, now);
        lastTrailSpawnAt = now;
      }
    }

    if (nextSpontaneousPopAt === 0) {
      nextSpontaneousPopAt = now + rand(1800, 5000);
    } else if (now >= nextSpontaneousPopAt) {
      const candidates = bubbles.filter(
        (b) => !b.popping && now - b.lastPopAt > 900
      );
      if (candidates.length) {
        const pick =
          candidates[Math.floor(Math.random() * candidates.length)];
        triggerPop(pick, now);
      }
      nextSpontaneousPopAt = now + rand(1800, 5000);
    }

    // Pop particles (draw first so bubbles sit on top)
    if (particles.length) {
      ctx.globalCompositeOperation = "screen";
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        const age = now - p.bornAt;
        if (age >= p.life) {
          particles.splice(i, 1);
          continue;
        }
        const k = 1 - age / p.life;
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.985;
        p.vy *= 0.985;

        ctx.fillStyle = `hsla(${p.hue}, 98%, 86%, ${0.22 * k})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * (0.7 + 0.8 * (1 - k)), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
    }

    for (const b of bubbles) {
      // gentle wander
      b.wobble += b.wobbleSpeed;
      const driftX = Math.cos(b.wobble) * 0.02;
      const driftY = Math.sin(b.wobble * 0.9) * 0.02;

      b.x += b.vx + driftX;
      b.y += b.vy + driftY;

      // hover → inflate → pop
      if (mouseActive && !b.popping && now - b.lastPopAt > 900) {
        const dxm = b.x - mouse.x;
        const dym = b.y - mouse.y;
        if (dxm * dxm + dym * dym <= (b.r * 0.92) * (b.r * 0.92)) {
          triggerPop(b, now);
        }
      }

      if (b.popping) {
        const inflateMs = 120;
        const dt = now - b.popStartAt;
        if (dt < inflateMs) {
          const s = easeOutCubic(dt / inflateMs);
          b.r = b.baseR * (1 + 0.55 * s);
        } else {
          // Pop!
          spawnPopParticles(b.x, b.y, b);
          spawnWaterDroplets(b.x, b.y, b, now);
          const replacement = makeBubble(true);
          Object.assign(b, replacement);
        }
      } else {
        b.r = b.baseR;
      }

      // mouse repel
      if (mouseActive) {
        const dx = b.x - mouse.x;
        const dy = b.y - mouse.y;
        const dist = Math.hypot(dx, dy);
        const influence = clamp((160 - dist) / 160, 0, 1);
        if (influence > 0) {
          const push = influence * 0.65;
          b.x += (dx / (dist || 1)) * push;
          b.y += (dy / (dist || 1)) * push;
        }
      }

      // wrap edges for an "array" feel
      const r = b.r;
      if (b.x < -r) b.x = w + r;
      else if (b.x > w + r) b.x = -r;
      if (b.y < -r) b.y = h + r;
      else if (b.y > h + r) b.y = -r;

      drawBubble(b, t);
    }

    // Water droplets: on top of field, under cursor trail
    if (droplets.length) {
      for (let i = droplets.length - 1; i >= 0; i--) {
        const p = droplets[i];
        const age = now - p.bornAt;
        if (age >= p.life) {
          droplets.splice(i, 1);
          continue;
        }
        const k = 1 - age / p.life;

        p.vy += 0.14;
        p.vx *= 0.987;
        p.vy *= 0.991;
        p.x += p.vx;
        p.y += p.vy;

        drawWaterDroplet(p, k);
      }
    }

    // Trail bubbles drawn last so they sit above the larger bubbles
    if (trail.length) {
      for (let i = trail.length - 1; i >= 0; i--) {
        const tb = trail[i];
        const age = now - tb.bornAt;
        if (age >= tb.life) {
          trail.splice(i, 1);
          continue;
        }
        const k = 1 - age / tb.life;

        tb.wobble += tb.wobbleSpeed;
        tb.vy -= 0.004; // gentle buoyancy
        tb.vx *= 0.992;
        tb.vy *= 0.996;
        tb.x += tb.vx + Math.cos(tb.wobble) * 0.18;
        tb.y += tb.vy;

        // shrink slightly as they age
        tb.r = tb.baseR * (0.6 + 0.4 * k);

        drawTrailBubble(tb, k);
      }
    }
  }

  function paintStatic() {
    // for reduced motion: draw one crisp frame
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    for (const b of bubbles) drawBubble(b, 0);
  }

  window.addEventListener(
    "mousemove",
    (e) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
      mouse.active = true;
      mouse.lastMoveAt = performance.now();
    },
    { passive: true }
  );

  window.addEventListener(
    "mouseleave",
    () => {
      mouse.active = false;
    },
    { passive: true }
  );

  window.addEventListener("resize", () => {
    resize();
    if (prefersReducedMotion) paintStatic();
  });

  resize();
  if (prefersReducedMotion) {
    paintStatic();
  } else {
    // initial clear
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    requestAnimationFrame(step);
  }
})();