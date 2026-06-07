// network.jsx — Canvas-based neural network visualization
// Renders plugins as clusters of neurons, with animated pulse connections.
// Imperative renderer wrapped by a thin React component.

(function () {
  const { useEffect, useRef, useState, useCallback } = React;

  // ─── THEME ─────────────────────────────────────────────────────────────────
  const THEMES = {
    atlas: {
      name: 'Atlas',
      bg: '#f3eee2',
      bgFar: '#ebe4d2',
      ink: 'rgba(28,24,18,0.92)',
      dim: 'rgba(60,50,40,0.55)',
      grid: 'rgba(60,40,20,0.05)',
      hues: [22, 200, 145, 280, 0, 50, 230, 165],
      neuronSat: 60,
      neuronLight: 32,
      link: 'rgba(60,40,20,0.18)',
      pulse: 'rgba(200,90,30,1)',
      dead: 'rgba(120,110,95,0.4)',
      light: true,
    },
  };

  // ─── LAYOUT ────────────────────────────────────────────────────────────────
  function buildLayout(plugins, links, density) {
    const n = plugins.length;
    const orbitR = density === 'aerated' ? 360 : density === 'dense' ? 200 : 250;
    // Stable hash seed per plugin id for jitter
    const seed = (s) => {
      let h = 2166136261;
      for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
      return ((h >>> 0) % 10000) / 10000;
    };

    const groups = plugins.map((p, i) => {
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
      // Pull bright/active plugins slightly inward, push dead ones outward
      const r = orbitR * (1 - p.usage * 0.18) + (1 - p.usage) * 30;
      const jx = (seed(p.id) - 0.5) * 24;
      const jy = (seed(p.id + 'y') - 0.5) * 24;
      const cx = Math.cos(angle) * r + jx;
      const cy = Math.sin(angle) * r + jy;

      // Cluster radius scales with file count
      const fc = p.files.length;
      const baseR = density === 'aerated' ? 32 : density === 'dense' ? 20 : 26;
      const groupR = baseR + fc * 1.8;

      // Neurons: positions relative to group center, with breathing phase
      const neurons = p.files.map((f, j) => {
        const ang = (j / fc) * Math.PI * 2 + seed(p.id + f) * Math.PI * 2;
        const rad = (seed(p.id + f + 'r') * 0.55 + 0.35) * groupR;
        return {
          file: f,
          baseX: Math.cos(ang) * rad,
          baseY: Math.sin(ang) * rad,
          phase: seed(p.id + f + 'p') * Math.PI * 2,
          size: 2.2 + seed(p.id + f + 's') * 1.8,
        };
      });

      return {
        ...p,
        cx, cy,
        groupR,
        neurons,
        // Drift parameters for organic group motion
        driftPhaseX: seed(p.id + 'dx') * Math.PI * 2,
        driftPhaseY: seed(p.id + 'dy') * Math.PI * 2,
        hueIdx: i,
      };
    });

    // Build link list with control points
    const linkObjs = links.map(([a, b, w]) => {
      const ga = groups.find((g) => g.id === a);
      const gb = groups.find((g) => g.id === b);
      if (!ga || !gb) return null;
      // Control point: midpoint pulled toward center (creates inward arc)
      const mx = (ga.cx + gb.cx) / 2;
      const my = (ga.cy + gb.cy) / 2;
      const dx = gb.cx - ga.cx;
      const dy = gb.cy - ga.cy;
      const dist = Math.hypot(dx, dy);
      // Normal toward center
      const cAngle = Math.atan2(my, mx);
      const inward = 0.18 + seed(a + b) * 0.1;
      const cpx = mx - Math.cos(cAngle) * dist * inward;
      const cpy = my - Math.sin(cAngle) * dist * inward;
      return { a, b, weight: w, cpx, cpy, pulses: [], lastSpawn: 0 };
    }).filter(Boolean);

    return { groups, links: linkObjs };
  }

  // ─── COLORS ────────────────────────────────────────────────────────────────
  function neuronColor(theme, group, brightness) {
    if (group.usage <= 0) return theme.dead;
    const hue = theme.hues[group.hueIdx % theme.hues.length];
    const l = Math.min(85, theme.neuronLight + brightness * 22);
    const s = theme.neuronSat;
    return `hsl(${hue} ${s}% ${l}%)`;
  }
  function glowColor(theme, group) {
    if (group.usage <= 0) return 'rgba(0,0,0,0)';
    const hue = theme.hues[group.hueIdx % theme.hues.length];
    return `hsl(${hue} ${theme.neuronSat}% ${theme.neuronLight + 10}%)`;
  }
  function glowColorAlpha(theme, group, alpha) {
    if (group.usage <= 0) return 'rgba(0,0,0,0)';
    const hue = theme.hues[group.hueIdx % theme.hues.length];
    return `hsla(${hue}, ${theme.neuronSat}%, ${theme.neuronLight + 10}%, ${alpha})`;
  }

  // ─── BEZIER HELPERS ────────────────────────────────────────────────────────
  function bezierPoint(t, p0, p1, p2) {
    const u = 1 - t;
    return {
      x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
      y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
    };
  }

  // ─── MAIN RENDERER (imperative) ────────────────────────────────────────────
  class NetworkRenderer {
    constructor(canvas, opts) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.opts = opts;
      // Diagnostics hook (used by screenshot tooling that runs in hidden iframes)
      window.__ocr = this;
      this.camera = { x: 0, y: 0, zoom: 1 };
      this.targetCamera = { x: 0, y: 0, zoom: 1 };
      this.t0 = performance.now();
      this.last = this.t0;
      this.running = true;
      this.hovered = null;
      this.timeScale = 1;
      this.searchMatch = null;
      this.onHover = opts.onHover || (() => {});

      this.resize();
      this.layout = buildLayout(opts.plugins, opts.links, opts.density);
      this.bindEvents();
      this.loop = this.loop.bind(this);
      requestAnimationFrame(this.loop);
    }

    setOpts(opts) {
      const prev = this.opts;
      this.opts = { ...this.opts, ...opts };
      if (opts.density && opts.density !== prev.density) {
        this.layout = buildLayout(this.opts.plugins, this.opts.links, this.opts.density);
      }
    }

    setSearch(q) {
      if (!q) { this.searchMatch = null; return; }
      const norm = q.toLowerCase().trim();
      this.searchMatch = (g) =>
        g.name.toLowerCase().includes(norm) ||
        g.short.toLowerCase().includes(norm) ||
        g.files.some((f) => f.toLowerCase().includes(norm));
    }

    setTimeScale(v) { this.timeScale = v; }

    focusPlugin(id) {
      const g = this.layout.groups.find((x) => x.id === id);
      if (!g) return;
      const zoom = 2.4;
      // Target screen position: center of the area between focus card (left) and side panel (right).
      const focusCardRight = 24 + 340 + 16;   // 380
      const sidePanelLeft = this.W - 24 - 312; // W - 336
      const targetScreenX = this.W > 1100
        ? (focusCardRight + sidePanelLeft) / 2
        : this.W / 2;
      const targetScreenY = this.H / 2;
      // Solve for camera so g.cx maps to targetScreenX (and g.cy to targetScreenY).
      const ox = this.viewOffset?.x || 0;
      const oy = this.viewOffset?.y || 0;
      this.targetCamera = {
        x: g.cx - (targetScreenX - this.W / 2 - ox) / zoom,
        y: g.cy - (targetScreenY - this.H / 2 - oy) / zoom,
        zoom,
      };
    }
    resetCamera() {
      this.targetCamera = { x: 0, y: 0, zoom: 1 };
    }

    resize() {
      const dpr = window.devicePixelRatio || 1;
      const rect = this.canvas.getBoundingClientRect();
      this.canvas.width = rect.width * dpr;
      this.canvas.height = rect.height * dpr;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.W = rect.width;
      this.H = rect.height;
      // Reserve space on right for side panel.
      const rightPanel = rect.width > 900 ? 180 : 0;
      this.viewOffset = { x: -rightPanel, y: 0 };
    }

    worldToScreen(x, y) {
      const s = this.camera.zoom;
      const ox = this.viewOffset?.x || 0;
      const oy = this.viewOffset?.y || 0;
      return {
        x: (x - this.camera.x) * s + this.W / 2 + ox,
        y: (y - this.camera.y) * s + this.H / 2 + oy,
      };
    }
    screenToWorld(x, y) {
      const s = this.camera.zoom;
      const ox = this.viewOffset?.x || 0;
      const oy = this.viewOffset?.y || 0;
      return {
        x: (x - this.W / 2 - ox) / s + this.camera.x,
        y: (y - this.H / 2 - oy) / s + this.camera.y,
      };
    }

    hitTest(sx, sy) {
      const w = this.screenToWorld(sx, sy);
      let best = null, bestD = Infinity;
      for (const g of this.layout.groups) {
        const d = Math.hypot(w.x - g.cx, w.y - g.cy);
        if (d < g.groupR + 14 && d < bestD) { bestD = d; best = g; }
      }
      return best;
    }

    bindEvents() {
      const c = this.canvas;
      let dragging = false;
      let dragStart = null;
      let dragMoved = false;
      c.addEventListener('pointerdown', (e) => {
        dragging = true; dragMoved = false;
        dragStart = { x: e.clientX, y: e.clientY, cx: this.camera.x, cy: this.camera.y };
        c.setPointerCapture(e.pointerId);
      });
      c.addEventListener('pointermove', (e) => {
        const rect = c.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        if (dragging) {
          const dx = e.clientX - dragStart.x;
          const dy = e.clientY - dragStart.y;
          if (Math.hypot(dx, dy) > 4) dragMoved = true;
          this.camera.x = dragStart.cx - dx / this.camera.zoom;
          this.camera.y = dragStart.cy - dy / this.camera.zoom;
          this.targetCamera.x = this.camera.x;
          this.targetCamera.y = this.camera.y;
        } else {
          const hit = this.hitTest(sx, sy);
          if (hit !== this.hovered) {
            this.hovered = hit;
            this.onHover(hit, { x: e.clientX, y: e.clientY });
          } else if (hit) {
            this.onHover(hit, { x: e.clientX, y: e.clientY });
          }
        }
      });
      c.addEventListener('pointerup', (e) => {
        if (dragging && !dragMoved) {
          const rect = c.getBoundingClientRect();
          const sx = e.clientX - rect.left;
          const sy = e.clientY - rect.top;
          const hit = this.hitTest(sx, sy);
          if (hit && this.opts.onClick) this.opts.onClick(hit);
          else if (!hit && this.opts.onClickBg) this.opts.onClickBg();
        }
        dragging = false;
      });
      c.addEventListener('pointercancel', () => { dragging = false; });
      c.addEventListener('pointerleave', () => {
        if (this.hovered) { this.hovered = null; this.onHover(null); }
      });
      c.addEventListener('wheel', (e) => {
        e.preventDefault();
        const rect = c.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const before = this.screenToWorld(sx, sy);
        const factor = Math.exp(-e.deltaY * 0.001);
        const newZoom = Math.max(0.4, Math.min(4, this.camera.zoom * factor));
        this.camera.zoom = newZoom;
        const after = this.screenToWorld(sx, sy);
        this.camera.x += before.x - after.x;
        this.camera.y += before.y - after.y;
        this.targetCamera = { ...this.camera };
      }, { passive: false });
    }

    // ── Frame ────────────────────────────────────────────────────────────────
    loop(now) {
      if (!this.running) return;
      const dt = Math.min(64, now - this.last);
      this.last = now;
      const t = (now - this.t0) / 1000;

      // Camera easing
      this.camera.x += (this.targetCamera.x - this.camera.x) * 0.12;
      this.camera.y += (this.targetCamera.y - this.camera.y) * 0.12;
      this.camera.zoom += (this.targetCamera.zoom - this.camera.zoom) * 0.12;

      this.draw(t, dt);
      requestAnimationFrame(this.loop);
    }

    draw(t, dt) {
      const ctx = this.ctx;
      const theme = THEMES[this.opts.theme] || THEMES.abyss;
      const { groups, links } = this.layout;

      // Background — radial vignette
      const grad = ctx.createRadialGradient(this.W / 2, this.H / 2, 0, this.W / 2, this.H / 2, Math.max(this.W, this.H) * 0.7);
      grad.addColorStop(0, theme.bgFar);
      grad.addColorStop(1, theme.bg);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, this.W, this.H);

      // Light grid (subtle)
      this.drawGrid(theme);

      // Animate group drift (organic wobble)
      for (const g of groups) {
        g._dx = Math.sin(t * 0.15 + g.driftPhaseX) * 8;
        g._dy = Math.cos(t * 0.18 + g.driftPhaseY) * 6;
      }

      // ── Connections (under neurons) ─────────────────────────────────────
      this.drawConnections(t, dt, theme);

      // ── Clusters & neurons ──────────────────────────────────────────────
      for (const g of groups) {
        this.drawCluster(g, t, theme);
      }

      // ── Labels ──────────────────────────────────────────────────────────
      this.drawLabels(theme);
    }

    drawGrid(theme) {
      const ctx = this.ctx;
      ctx.strokeStyle = theme.grid;
      ctx.lineWidth = 1;
      const spacing = 80 * this.camera.zoom;
      const ox = ((-this.camera.x * this.camera.zoom) % spacing + spacing) % spacing;
      const oy = ((-this.camera.y * this.camera.zoom) % spacing + spacing) % spacing;
      ctx.beginPath();
      for (let x = ox; x < this.W; x += spacing) {
        ctx.moveTo(x, 0); ctx.lineTo(x, this.H);
      }
      for (let y = oy; y < this.H; y += spacing) {
        ctx.moveTo(0, y); ctx.lineTo(this.W, y);
      }
      ctx.stroke();
    }

    drawConnections(t, dt, theme) {
      const ctx = this.ctx;
      const z = this.camera.zoom;
      const { groups, links } = this.layout;
      const groupMap = new Map(groups.map((g) => [g.id, g]));
      const ts = this.timeScale;
      const focused = this.opts.focusedId;

      for (const lk of links) {
        const ga = groupMap.get(lk.a);
        const gb = groupMap.get(lk.b);
        if (!ga || !gb) continue;
        const dim = focused && focused !== ga.id && focused !== gb.id;
        const isDead = lk.weight <= 0.001;
        const w = lk.weight;

        const p0 = this.worldToScreen(ga.cx + ga._dx, ga.cy + ga._dy);
        const p2 = this.worldToScreen(gb.cx + gb._dx, gb.cy + gb._dy);
        const p1 = this.worldToScreen(lk.cpx, lk.cpy);

        // Base line
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.quadraticCurveTo(p1.x, p1.y, p2.x, p2.y);
        const alphaMul = dim ? 0.22 : 1;
        if (isDead) {
          ctx.strokeStyle = theme.dead;
          ctx.setLineDash([2, 4]);
          ctx.globalAlpha = 0.4 * alphaMul;
        } else {
          ctx.strokeStyle = theme.link;
          ctx.setLineDash([]);
          const baseAlpha = theme.light ? 0.2 + w * 0.35 : 0.35 + w * 0.45;
          ctx.globalAlpha = baseAlpha * alphaMul;
        }
        ctx.lineWidth = (0.6 + w * 1.4);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.setLineDash([]);

        // Pulse spawn
        if (!isDead && !dim) {
          const spawnInterval = 1400 / (0.4 + w * 4); // ms, in time-scaled units
          lk.lastSpawn += dt * ts;
          if (lk.lastSpawn > spawnInterval) {
            lk.lastSpawn = 0;
            // Random direction
            const dir = Math.random() < 0.5 ? 1 : -1;
            lk.pulses.push({ t: dir === 1 ? 0 : 1, dir, life: 1 });
          }
        }

        // Update + draw pulses
        const speed = (0.3 + w * 1.4) * 0.0006; // per ms
        for (let i = lk.pulses.length - 1; i >= 0; i--) {
          const p = lk.pulses[i];
          p.t += p.dir * speed * dt * ts;
          if (p.t < 0 || p.t > 1) { lk.pulses.splice(i, 1); continue; }
          const pt = bezierPoint(p.t, p0, p1, p2);
          const fade = Math.sin(p.t * Math.PI);
          ctx.save();
          ctx.globalCompositeOperation = theme.light ? 'source-over' : 'screen';
          ctx.shadowBlur = 14 * (1 + w);
          ctx.shadowColor = theme.pulse;
          ctx.fillStyle = theme.pulse;
          ctx.globalAlpha = fade * (dim ? 0.25 : 0.95);
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 2 + w * 2.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }
    }

    drawCluster(g, t, theme) {
      const ctx = this.ctx;
      const z = this.camera.zoom;
      const center = this.worldToScreen(g.cx + g._dx, g.cy + g._dy);
      const shape = this.opts.clusterShape;
      const usage = g.usage;
      const dead = usage <= 0;
      const isHover = this.hovered && this.hovered.id === g.id;
      const isFocused = this.opts.focusedId === g.id;
      const matched = this.searchMatch ? this.searchMatch(g) : true;
      const dimmed = this.searchMatch && !matched;

      // ── Aura/halo ─────────────────────────────────────────────────────
      if (!dead && (shape === 'halo' || shape === 'blob')) {
        const auraR = g.groupR * z * (shape === 'blob' ? 1.5 : 2.2);
        const auraGrad = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, auraR);
        auraGrad.addColorStop(0, glowColorAlpha(theme, g, 0.32 * usage));
        auraGrad.addColorStop(0.6, glowColorAlpha(theme, g, 0.08 * usage));
        auraGrad.addColorStop(1, glowColorAlpha(theme, g, 0));
        ctx.save();
        ctx.globalCompositeOperation = theme.light ? 'multiply' : 'lighter';
        ctx.globalAlpha = dimmed ? 0.2 : 1;
        ctx.fillStyle = auraGrad;
        ctx.beginPath();
        ctx.arc(center.x, center.y, auraR, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // ── Outline (ring or blob) ───────────────────────────────────────
      if (shape === 'ring' || shape === 'blob') {
        ctx.save();
        ctx.globalAlpha = dimmed ? 0.2 : (dead ? 0.4 : 0.55);
        ctx.lineWidth = isFocused || isHover ? 1.4 : 0.8;
        const lineCol = dead ? theme.dead : (theme.light ? theme.dim : neuronColor(theme, g, 0.5));
        ctx.strokeStyle = lineCol;
        ctx.setLineDash(dead ? [2, 4] : []);
        if (shape === 'ring') {
          ctx.beginPath();
          ctx.arc(center.x, center.y, g.groupR * z * 1.1, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          // Blob: irregular closed curve
          const segs = 18;
          ctx.beginPath();
          for (let i = 0; i <= segs; i++) {
            const a = (i / segs) * Math.PI * 2;
            const wob = Math.sin(t * 0.4 + i * 0.7 + g.driftPhaseX) * 0.16;
            const r = g.groupR * z * (1.15 + wob);
            const x = center.x + Math.cos(a) * r;
            const y = center.y + Math.sin(a) * r;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.stroke();
        }
        ctx.restore();
        ctx.setLineDash([]);
      }

      // ── Neurons ──────────────────────────────────────────────────────
      const brightness = usage; // 0..1
      ctx.save();
      ctx.globalAlpha = dimmed ? 0.25 : 1;
      for (const n of g.neurons) {
        const breath = 1 + Math.sin(t * 1.4 + n.phase) * 0.15 * usage;
        const wx = g.cx + g._dx + n.baseX;
        const wy = g.cy + g._dy + n.baseY;
        const p = this.worldToScreen(wx, wy);
        const r = n.size * z * 0.9 * breath;

        if (!dead && !theme.light) {
          ctx.shadowBlur = 10 + brightness * 16;
          ctx.shadowColor = glowColor(theme, g);
        } else {
          ctx.shadowBlur = 0;
        }
        ctx.fillStyle = neuronColor(theme, g, brightness);
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();

        // Bright core for highly used
        if (!dead && brightness > 0.4 && !theme.light) {
          ctx.shadowBlur = 0;
          ctx.fillStyle = 'rgba(255,255,255,' + (0.3 + brightness * 0.5) + ')';
          ctx.beginPath();
          ctx.arc(p.x, p.y, r * 0.4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
      ctx.shadowBlur = 0;
    }

    drawLabels(theme) {
      const ctx = this.ctx;
      const focusedId = this.opts.focusedId;
      for (const g of this.layout.groups) {
        const center = this.worldToScreen(g.cx + g._dx, g.cy + g._dy);
        const isHover = this.hovered && this.hovered.id === g.id;
        const isFocus = focusedId === g.id;
        const matched = this.searchMatch ? this.searchMatch(g) : false;
        const showAlways = g.usage > 0.55 || this.opts.alwaysLabels;
        if (!showAlways && !isHover && !isFocus && !matched) continue;

        const dimmed = this.searchMatch && !matched && !isHover && !isFocus;
        const y = center.y + g.groupR * this.camera.zoom + 14;
        ctx.save();
        ctx.font = `${isFocus || isHover ? '600' : '500'} 11px ui-sans-serif,system-ui,sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const txt = g.name;
        const m = ctx.measureText(txt);
        const pad = 6, h = 16;
        const x0 = center.x - m.width / 2 - pad;
        // pill bg
        ctx.fillStyle = theme.light ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.55)';
        ctx.globalAlpha = dimmed ? 0.3 : (isFocus || isHover ? 1 : 0.85);
        roundRect(ctx, x0, y - 2, m.width + pad * 2, h, 4);
        ctx.fill();
        ctx.fillStyle = theme.ink;
        ctx.fillText(txt, center.x, y);

        // usage tick (tiny bar under label)
        if (g.usage > 0) {
          const barW = 28;
          ctx.fillStyle = theme.dim;
          ctx.globalAlpha = (dimmed ? 0.25 : 0.6);
          ctx.fillRect(center.x - barW / 2, y + h + 2, barW, 1.5);
          ctx.fillStyle = theme.pulse;
          ctx.globalAlpha = (dimmed ? 0.4 : 1) * (0.55 + g.usage * 0.45);
          ctx.fillRect(center.x - barW / 2, y + h + 2, barW * g.usage, 1.5);
        }
        ctx.restore();
      }
    }

    destroy() { this.running = false; }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  // ─── REACT WRAPPER ─────────────────────────────────────────────────────────
  function NetworkCanvas(props) {
    const canvasRef = useRef(null);
    const rendererRef = useRef(null);

    useEffect(() => {
      const canvas = canvasRef.current;
      const r = new NetworkRenderer(canvas, {
        plugins: props.plugins || window.PLUGINS,
        links: props.links || window.LINKS,
        theme: props.theme,
        clusterShape: props.clusterShape,
        density: props.density,
        alwaysLabels: props.alwaysLabels,
        focusedId: props.focusedId,
        onHover: props.onHover,
        onClick: props.onClick,
        onClickBg: props.onClickBg,
      });
      rendererRef.current = r;
      const onResize = () => r.resize();
      window.addEventListener('resize', onResize);
      return () => {
        r.destroy();
        window.removeEventListener('resize', onResize);
      };
    }, []);

    // Sync prop changes
    useEffect(() => {
      const r = rendererRef.current; if (!r) return;
      r.setOpts({
        theme: props.theme,
        clusterShape: props.clusterShape,
        density: props.density,
        alwaysLabels: props.alwaysLabels,
        focusedId: props.focusedId,
        onClick: props.onClick,
        onClickBg: props.onClickBg,
      });
    }, [props.theme, props.clusterShape, props.density, props.alwaysLabels, props.focusedId, props.onClick, props.onClickBg]);

    useEffect(() => {
      const r = rendererRef.current; if (!r) return;
      r.setSearch(props.searchQuery);
    }, [props.searchQuery]);

    useEffect(() => {
      const r = rendererRef.current; if (!r) return;
      r.setTimeScale(props.timeScale);
    }, [props.timeScale]);

    useEffect(() => {
      const r = rendererRef.current; if (!r) return;
      if (props.focusedId) r.focusPlugin(props.focusedId);
      else r.resetCamera();
    }, [props.focusedId]);

    return <canvas ref={canvasRef} className="network-canvas" />;
  }

  window.NetworkCanvas = NetworkCanvas;
  window.OC_THEMES = THEMES;
})();
