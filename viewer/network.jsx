// network.jsx — 3D rotatable sphere ("globe") visualization
// Plugins live on the surface of a sphere; drag to spin, scroll to zoom.
// Connections are great-circle arcs hugging the surface. Imperative renderer
// wrapped by a thin React component (same public API as before).

(function () {
  const { useEffect, useRef } = React;

  // ─── THEME ─────────────────────────────────────────────────────────────────
  const THEMES = {
    atlas: {
      name: 'Atlas',
      bg: '#f3eee2',
      bgFar: '#ebe4d2',
      ink: 'rgba(28,24,18,0.92)',
      dim: 'rgba(60,50,40,0.55)',
      grid: 'rgba(60,40,20,0.05)',
      globeFill: 'rgba(255,253,247,0.55)',
      globeShade: 'rgba(70,52,28,0.16)',
      meridian: 'rgba(70,52,28,0.13)',
      hues: [22, 200, 145, 280, 0, 50, 230, 165],
      neuronSat: 60,
      neuronLight: 32,
      link: 'rgba(60,40,20,0.20)',
      pulse: 'rgba(200,90,30,1)',
      dead: 'rgba(120,110,95,0.4)',
      light: true,
    },
  };

  // ─── VEC3 HELPERS ────────────────────────────────────────────────────────
  function norm(v) {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  }
  function cross(a, b) {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
  }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

  // Spherical-linear interpolation between two unit vectors.
  function slerp(a, b, t) {
    let d = Math.max(-1, Math.min(1, dot(a, b)));
    const om = Math.acos(d);
    if (om < 1e-4) return a.slice();
    const so = Math.sin(om);
    // Near-antipodal points: the great circle is undefined and the standard
    // formula divides by ~0, collapsing the arc into a chord through the
    // sphere centre (the stray straight line). Route it instead by rotating
    // `a` toward `b` around a perpendicular axis so it hugs the surface.
    if (so < 1e-3) {
      let axis = cross(a, [0, 1, 0]);
      if (Math.hypot(axis[0], axis[1], axis[2]) < 1e-4) axis = cross(a, [1, 0, 0]);
      axis = norm(axis);
      const ang = om * t;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const da = dot(axis, a);
      // Rodrigues rotation of `a` about `axis` by `ang`.
      return norm([
        a[0] * ca + (axis[1] * a[2] - axis[2] * a[1]) * sa + axis[0] * da * (1 - ca),
        a[1] * ca + (axis[2] * a[0] - axis[0] * a[2]) * sa + axis[1] * da * (1 - ca),
        a[2] * ca + (axis[0] * a[1] - axis[1] * a[0]) * sa + axis[2] * da * (1 - ca),
      ]);
    }
    const k0 = Math.sin((1 - t) * om) / so;
    const k1 = Math.sin(t * om) / so;
    return [a[0] * k0 + b[0] * k1, a[1] * k0 + b[1] * k1, a[2] * k0 + b[2] * k1];
  }

  // ─── LAYOUT ────────────────────────────────────────────────────────────────
  function buildLayout(plugins, links, density) {
    const n = plugins.length;
    const radius = density === 'aerated' ? 1 : density === 'dense' ? 1 : 1; // unit sphere; pixel scale applied at draw
    const seed = (s) => {
      let h = 2166136261;
      for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
      return ((h >>> 0) % 10000) / 10000;
    };

    // Fibonacci-sphere distribution → even spread of plugins over the surface.
    const golden = Math.PI * (3 - Math.sqrt(5));
    const groups = plugins.map((p, i) => {
      const y = 1 - (i / Math.max(1, n - 1)) * 2; // 1 → -1
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = golden * i;
      const dir = norm([Math.cos(theta) * r, y, Math.sin(theta) * r]);

      // Tangent basis at this point (u, v perpendicular to dir).
      const up = Math.abs(dir[1]) < 0.98 ? [0, 1, 0] : [1, 0, 0];
      const u = norm(cross(up, dir));
      const v = cross(dir, u);

      const fc = p.files.length;
      const baseR = density === 'aerated' ? 0.13 : density === 'dense' ? 0.085 : 0.105;
      const groupR = baseR + fc * 0.006; // patch radius in unit-sphere terms

      const neurons = p.files.map((f, j) => {
        const ang = (j / fc) * Math.PI * 2 + seed(p.id + f) * Math.PI * 2;
        const rad = (seed(p.id + f + 'r') * 0.55 + 0.35) * groupR;
        return {
          file: f,
          ox: Math.cos(ang) * rad,
          oy: Math.sin(ang) * rad,
          phase: seed(p.id + f + 'p') * Math.PI * 2,
          size: (2.2 + seed(p.id + f + 's') * 1.8),
        };
      });

      return {
        ...p,
        dir, u, v,
        groupR,
        neurons,
        breathPhase: seed(p.id + 'b') * Math.PI * 2,
        hueIdx: i,
      };
    });

    const linkObjs = links.map(([a, b, w, count]) => {
      const ga = groups.find((g) => g.id === a);
      const gb = groups.find((g) => g.id === b);
      if (!ga || !gb) return null;
      // Pre-sample the great-circle arc between the two surface points.
      const SAMP = 26;
      const pts = [];
      for (let i = 0; i <= SAMP; i++) pts.push(slerp(ga.dir, gb.dir, i / SAMP));
      const co = count || 0;
      // Pulses flow from the more-used skill toward its complement.
      // dir = 1 → travels a→b (t:0→1); dir = -1 → travels b→a (t:1→0).
      const dir = ga.usage >= gb.usage ? 1 : -1;
      // Stagger the first spawn so links don't all fire on frame 0.
      const interval = co > 0 ? 45000 / co : 0;
      return {
        a, b, weight: w, count: co, dir, pts, pulses: [],
        lastSpawn: interval ? seed(a + b + 'spawn') * interval : 0,
      };
    }).filter(Boolean);

    const maxCount = Math.max(1, ...linkObjs.map((l) => l.count));
    return { groups, links: linkObjs, maxCount };
  }

  // (equirectangular unwrap for 2D view — lon→x lat→y, handled inside project())

  // ─── COLORS ────────────────────────────────────────────────────────────────
  function neuronColor(theme, group, brightness) {
    if (group.usage <= 0) return theme.dead;
    const hue = theme.hues[group.hueIdx % theme.hues.length];
    const l = Math.min(85, theme.neuronLight + brightness * 22);
    return `hsl(${hue} ${theme.neuronSat}% ${l}%)`;
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

  // Strip the "skill:" prefix for display only (ids/search keep the full name).
  function displayName(name) {
    return (name || '').replace(/^skill:\s*/i, '');
  }

  // ─── MAIN RENDERER (imperative) ────────────────────────────────────────────
  class NetworkRenderer {
    constructor(canvas, opts) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.opts = opts;
      window.__ocr = this;

      // Rotation state (yaw = ry about world-Y, pitch = rx about world-X).
      this.rot = { x: -0.35, y: 0.4 };
      this.focusRot = null;       // when focusing a plugin, ease toward this
      this.vel = { x: 0, y: 0 };  // angular velocity for drag inertia
      this.zoom = 1;
      this.targetZoom = 1;
      this.flat = 0;              // 0 = sphere, 1 = unwrapped 2D map
      this.targetFlat = 0;

      this.t0 = performance.now();
      this.last = this.t0;
      this.running = true;
      this.hovered = null;
      this.timeScale = 1;
      this.searchMatch = null;
      this.dragging = false;
      this.idleSince = this.t0;
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
      if (opts.flat !== undefined) this.targetFlat = opts.flat ? 1 : 0;
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

    // Total live pulses across every link — enforces the 100-pulse ceiling.
    totalPulses() {
      let n = 0;
      for (const l of this.layout.links) n += l.pulses.length;
      return n;
    }

    // ── Geometry: rotate a unit vector by current yaw/pitch ──────────────────
    rotateVec(v, rx, ry) {
      // yaw about Y
      const cy = Math.cos(ry), sy = Math.sin(ry);
      const x1 = v[0] * cy + v[2] * sy;
      const z1 = -v[0] * sy + v[2] * cy;
      const y1 = v[1];
      // pitch about X
      const cx = Math.cos(rx), sx = Math.sin(rx);
      const y2 = y1 * cx - z1 * sx;
      const z2 = y1 * sx + z1 * cx;
      return [x1, y2, z2];
    }

    // Project a rotated point. Z>0 = toward camera (front hemisphere).
    // When `flat` > 0 we morph each point toward an equirectangular unwrap
    // (longitude → x, latitude → y) so the globe peels open into a flat map.
    project(rv) {
      const R = this.sphereR;
      const focal = R * 3.2;
      const z = rv[2] * R;
      const sScale = focal / (focal - z);
      const sx = this.cx + rv[0] * R * sScale;
      const sy = this.cy + rv[1] * R * sScale;
      // Hidden (back) hemisphere reads 30% fainter than depth alone implies.
      const backDim = rv[2] < 0 ? 0.7 : 1;
      const baseFade = (0.4 + 0.6 * ((rv[2] + 1) / 2)) * backDim;
      const f = this.flat;
      if (f < 1e-3) {
        return { x: sx, y: sy, z, nz: rv[2], scale: sScale, depthFade: baseFade };
      }
      const lon = Math.atan2(rv[0], rv[1]);  // xy-plane angle (Z-pole frame)
      const lat = Math.asin(Math.max(-1, Math.min(1, rv[2])));
      const fx = this.cx + (lon / Math.PI) * this.flatW;
      const fy = this.cy + (lat / (Math.PI / 2)) * this.flatH;
      return {
        x: sx + (fx - sx) * f,
        y: sy + (fy - sy) * f,
        z,
        nz: rv[2],
        scale: sScale + (1 - sScale) * f,
        depthFade: baseFade * (1 - f) + f,
        lon,
      };
    }

    resize() {
      const dpr = window.devicePixelRatio || 1;
      const rect = this.canvas.getBoundingClientRect();
      this.canvas.width = rect.width * dpr;
      this.canvas.height = rect.height * dpr;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.W = rect.width;
      this.H = rect.height;
      this.recenter();
    }

    recenter() {
      // Reserve room on the right for the side panel; center the globe in the rest.
      const rightPanel = this.W > 900 ? 336 : 0;
      const focusCard = (this.opts.focusedId && this.W > 1100) ? 380 : 0;
      const left = focusCard;
      const right = this.W - rightPanel;
      this.cx = (left + right) / 2;
      this.cy = this.H / 2;
      const avail = Math.min(right - left, this.H);
      this.sphereR = Math.max(120, avail * 0.42) * this.zoom;
      // Equirectangular unwrap spread (lon → x, lat → y).
      const usableW = (right - left) * 0.92;
      this.flatW = Math.min(usableW / 2, this.sphereR * 2.1);
      this.flatH = Math.min(this.H * 0.45, this.flatW * 0.68);
    }

    // ── Hit testing ──────────────────────────────────────────────────────────
    hitTest(sx, sy) {
      let best = null, bestD = Infinity;
      for (const g of this.layout.groups) {
        if ((g.vis === undefined ? 1 : g.vis) < 0.35) continue; // hidden by focus mode
        const rv = this.rotateVec(g.dir, this.rot.x, this.rot.y);
        if (rv[2] < -0.05 && this.flat < 0.5) continue; // back hemisphere (3D only)
        const p = this.project([rv[0], rv[1], rv[2]]);
        const hitR = (g.groupR * this.sphereR * p.scale) + 16;
        const d = Math.hypot(sx - p.x, sy - p.y);
        if (d < hitR && d < bestD) { bestD = d; best = g; }
      }
      return best;
    }

    bindEvents() {
      const c = this.canvas;
      let dragStart = null;
      let dragMoved = false;
      let lastMove = null;

      c.addEventListener('pointerdown', (e) => {
        this.dragging = true; dragMoved = false;
        this.focusRot = null; // user takes control
        const rect = c.getBoundingClientRect();
        dragStart = { x: e.clientX, y: e.clientY, rx: this.rot.x, ry: this.rot.y, t: performance.now() };
        lastMove = { x: e.clientX, y: e.clientY, t: performance.now() };
        this.vel = { x: 0, y: 0 };
        c.setPointerCapture(e.pointerId);
      });
      c.addEventListener('pointermove', (e) => {
        const rect = c.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        if (this.dragging) {
          const dx = e.clientX - dragStart.x;
          const dy = e.clientY - dragStart.y;
          if (Math.hypot(dx, dy) > 4) dragMoved = true;
          const k = 0.006;
          // Horizontal drag follows the cursor (yaw tracks dx directly);
          // vertical stays inverted so dragging down tips the globe down.
          this.rot.y = dragStart.ry + dx * k;
          this.rot.x = dragStart.rx - dy * k;
          const now = performance.now();
          const dt = Math.max(1, now - lastMove.t);
          // Lighter momentum: smaller capture factor, snappier feel.
          this.vel.y = ((e.clientX - lastMove.x) * k) / dt * 7;
          this.vel.x = (-(e.clientY - lastMove.y) * k) / dt * 7;
          lastMove = { x: e.clientX, y: e.clientY, t: now };
          this.idleSince = now;
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
        if (this.dragging && !dragMoved) {
          const rect = c.getBoundingClientRect();
          const hit = this.hitTest(e.clientX - rect.left, e.clientY - rect.top);
          if (hit && this.opts.onClick) this.opts.onClick(hit);
          else if (!hit && this.opts.onClickBg) this.opts.onClickBg();
          this.vel = { x: 0, y: 0 };
        }
        this.dragging = false;
        this.idleSince = performance.now();
      });
      c.addEventListener('pointercancel', () => { this.dragging = false; });
      c.addEventListener('pointerleave', () => {
        if (this.hovered) { this.hovered = null; this.onHover(null); }
      });
      c.addEventListener('wheel', (e) => {
        e.preventDefault();
        const factor = Math.exp(-e.deltaY * 0.001);
        this.targetZoom = Math.max(0.6, Math.min(2.6, this.targetZoom * factor));
      }, { passive: false });
    }

    focusPlugin(id) {
      const g = this.layout.groups.find((x) => x.id === id);
      if (!g) return;
      const [x, y, z] = g.dir;
      // Rotation that brings this surface point to face the camera (+Z).
      const ry = Math.atan2(-x, z);
      const zr = Math.hypot(x, z);
      const rx = Math.atan2(y, zr);
      this.focusRot = { x: rx, y: ry };
      this.targetZoom = 1.35;
      this.vel = { x: 0, y: 0 };
    }
    resetCamera() {
      this.focusRot = null;
      this.targetZoom = 1;
    }

    // ── Frame ────────────────────────────────────────────────────────────────
    // Focus mode: only the focused skill and its complementary peers stay
    // visible. Per-group `vis` eases 0↔1 so they fade in/out smoothly; clearing
    // focus brings everyone back.
    focusVisible(id) {
      if (!id) return null;
      const s = new Set([id]);
      for (const lk of this.layout.links) {
        if (lk.count <= 0) continue; // only real complementarity counts
        if (lk.a === id) s.add(lk.b);
        else if (lk.b === id) s.add(lk.a);
      }
      return s;
    }

    updateVisibility() {
      const fs = this.focusVisible(this.opts.focusedId);
      for (const g of this.layout.groups) {
        if (g.vis === undefined) g.vis = 1;
        const target = !fs || fs.has(g.id) ? 1 : 0;
        g.vis += (target - g.vis) * 0.16;
        if (Math.abs(target - g.vis) < 0.003) g.vis = target;
      }
    }

    loop(now) {
      if (!this.running) return;
      const dt = Math.min(64, now - this.last);
      this.last = now;
      const t = (now - this.t0) / 1000;

      // Zoom easing
      if (Math.abs(this.targetZoom - this.zoom) > 1e-3) {
        this.zoom += (this.targetZoom - this.zoom) * 0.12;
        this.recenter();
      }
      // Flatten / un-flatten easing (morph between sphere and 2D map)
      if (Math.abs(this.targetFlat - this.flat) > 1e-4) {
        this.flat += (this.targetFlat - this.flat) * 0.09;
        if (Math.abs(this.targetFlat - this.flat) < 1e-3) this.flat = this.targetFlat;
      }

      if (this.focusRot) {
        // Ease toward focus, taking the shortest yaw path.
        let dy = this.focusRot.y - this.rot.y;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        this.rot.y += dy * 0.12;
        this.rot.x += (this.focusRot.x - this.rot.x) * 0.12;
      } else if (!this.dragging) {
        // Inertia + idle auto-rotate.
        this.rot.y += this.vel.y;
        this.rot.x += this.vel.x;
        this.vel.y *= 0.88;
        this.vel.x *= 0.88;
        if (Math.abs(this.vel.y) < 1e-4) this.vel.y = 0;
        if (Math.abs(this.vel.x) < 1e-4) this.vel.x = 0;
        const idle = now - this.idleSince > 2600;
        // Don't auto-spin while flattened into a map.
        if (idle && this.opts.autoRotate !== false && this.targetFlat < 0.5 && Math.abs(this.vel.y) < 0.003) {
          this.rot.y += 0.00095 * this.timeScale * (dt / 16);
        }
      }

      this.updateVisibility();
      this.draw(t, dt);
      requestAnimationFrame(this.loop);
    }

    draw(t, dt) {
      const ctx = this.ctx;
      const theme = THEMES[this.opts.theme] || THEMES.atlas;

      // Background — radial vignette
      const grad = ctx.createRadialGradient(this.W / 2, this.H / 2, 0, this.W / 2, this.H / 2, Math.max(this.W, this.H) * 0.7);
      grad.addColorStop(0, theme.bgFar);
      grad.addColorStop(1, theme.bg);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, this.W, this.H);

      this.drawGlobe(theme, t);
      this.drawConnections(t, dt, theme, false); // back arcs
      this.drawClusters(t, theme, false);        // back hemisphere clusters
      this.drawConnections(t, dt, theme, true);  // front arcs
      this.drawClusters(t, theme, true);         // front hemisphere clusters
      this.drawLabels(theme);
    }

    // ── Globe body: limb shading + optional meridian/parallel wireframe ──────
    drawGlobe(theme, t) {
      const ctx = this.ctx;
      const R = this.sphereR;
      // Globe body fades out as we flatten; fully hidden when showGlobe is off.
      const globeAlpha = (this.opts.showGlobe === false ? 0 : 1) * (this.opts.globeOpacity != null ? this.opts.globeOpacity : 1) * (1 - this.flat);
      if (globeAlpha <= 0.01) return;
      // Soft sphere body with a light from upper-left and limb darkening.
      const g = ctx.createRadialGradient(
        this.cx - R * 0.32, this.cy - R * 0.34, R * 0.1,
        this.cx, this.cy, R * 1.02
      );
      g.addColorStop(0, theme.globeFill);
      g.addColorStop(0.7, 'rgba(255,253,247,0.10)');
      g.addColorStop(1, theme.globeShade);
      ctx.save();
      ctx.beginPath();
      ctx.arc(this.cx, this.cy, R, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.globalAlpha = globeAlpha;
      ctx.globalCompositeOperation = theme.light ? 'multiply' : 'screen';
      ctx.fill();
      ctx.restore();

      // Rim
      ctx.beginPath();
      ctx.arc(this.cx, this.cy, R, 0, Math.PI * 2);
      ctx.strokeStyle = theme.globeShade;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.7 * globeAlpha;
      ctx.stroke();
      ctx.globalAlpha = 1;

      if (this.opts.wireframe === false) return;

      // Meridians (longitude) + parallels (latitude). Draw front segments solid,
      // back segments faint, so the grid reads as a transparent globe.
      const drawLine = (samples) => {
        // split into front/back runs for nicer depth feel
        for (let half = 0; half < 2; half++) {
          ctx.beginPath();
          let pen = false;
          for (const v of samples) {
            const rv = this.rotateVec(v, this.rot.x, this.rot.y);
            const front = rv[2] >= 0;
            if ((half === 0) !== front) { pen = false; continue; }
            const p = this.project(rv);
            if (!pen) { ctx.moveTo(p.x, p.y); pen = true; }
            else ctx.lineTo(p.x, p.y);
          }
          ctx.strokeStyle = theme.meridian;
          ctx.lineWidth = half === 0 ? 1 : 0.7;
          ctx.globalAlpha = (half === 0 ? 1 : 0.4) * globeAlpha;
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      };

      const SEG = 48;
      // meridians
      for (let m = 0; m < 6; m++) {
        const lon = (m / 6) * Math.PI;
        const pts = [];
        for (let i = 0; i <= SEG; i++) {
          const lat = -Math.PI / 2 + (i / SEG) * Math.PI;
          pts.push([Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)]);
        }
        drawLine(pts);
      }
      // parallels
      for (let pn = 1; pn < 5; pn++) {
        const lat = -Math.PI / 2 + (pn / 5) * Math.PI;
        const pts = [];
        for (let i = 0; i <= SEG; i++) {
          const lon = (i / SEG) * Math.PI * 2;
          pts.push([Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)]);
        }
        drawLine(pts);
      }
    }

    // ── Connections (great-circle arcs) ──────────────────────────────────────
    drawConnections(t, dt, theme, frontPass) {
      const ctx = this.ctx;
      const groupMap = new Map(this.layout.groups.map((g) => [g.id, g]));
      const ts = this.timeScale;
      const focused = this.opts.focusedId;

      for (const lk of this.layout.links) {
        const ga = groupMap.get(lk.a);
        const gb = groupMap.get(lk.b);
        if (!ga || !gb) continue;
        const dim = focused && focused !== ga.id && focused !== gb.id;
        const isDead = lk.weight <= 0.001;
        const w = lk.weight;
        // Hide links whose endpoints are faded out by focus mode.
        const visA = ga.vis === undefined ? 1 : ga.vis;
        const visB = gb.vis === undefined ? 1 : gb.vis;
        const linkVis = Math.min(visA, visB);
        if (linkVis < 0.01) continue;

        // Project all arc samples — project() handles the equirectangular morph.
        const proj = lk.pts.map((v) => {
          const rv = this.rotateVec(v, this.rot.x, this.rot.y);
          return { ...this.project(rv), nz: rv[2] };
        });
        const seamSkip = this.flat * this.flatW; // suppress streaks across lon ±π seam

        // Draw segments belonging to this pass (front/back).
        ctx.lineWidth = (1.0 + w * 1.4);
        for (let i = 0; i < proj.length - 1; i++) {
          const aSeg = proj[i], bSeg = proj[i + 1];
          const segFront = (aSeg.nz + bSeg.nz) / 2 >= 0;
          if (segFront !== frontPass) continue;
          if (seamSkip > 0 && Math.abs(aSeg.x - bSeg.x) > seamSkip) continue;
          const depthA = (aSeg.depthFade + bSeg.depthFade) / 2;
          ctx.beginPath();
          ctx.moveTo(aSeg.x, aSeg.y);
          ctx.lineTo(bSeg.x, bSeg.y);
          if (isDead) {
            ctx.strokeStyle = theme.dead;
            ctx.setLineDash([2, 4]);
            ctx.globalAlpha = 0.4 * depthA * (dim ? 0.4 : 1) * linkVis;
          } else {
            ctx.strokeStyle = theme.link;
            ctx.setLineDash([]);
            // Edges read stronger in the flat equirectangular view.
            const linkBoost = 1 + this.flat * 0.6;
            ctx.globalAlpha = Math.min(0.8, (0.35 + w * 0.4) * linkBoost) * depthA * (dim ? 0.3 : 1) * linkVis;
          }
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.setLineDash([]);

        // Pulse spawning happens once (on the front pass to avoid doubling).
        // Each pulse = one co-use of the two skills. Over a 45s loop exactly
        // `count` pulses traverse the link. Because the data only records that
        // the two ran together (not who called whom), pulses alternate
        // direction — a two-way shimmer rather than a misleading one-way flow.
        // A global ceiling of 100 simultaneous pulses keeps the scene legible.
        if (frontPass && !isDead && !dim && lk.count > 0) {
          const spawnInterval = 45000 / lk.count; // ms between pulses
          lk.lastSpawn += dt * ts;
          if (lk.lastSpawn >= spawnInterval) {
            // Keep the remainder so spacing stays even across frames.
            lk.lastSpawn -= spawnInterval;
            if (this.totalPulses() < 100) {
              lk._parity = (lk._parity || 0) + 1;
              const dir = lk._parity % 2 === 0 ? 1 : -1;
              lk.pulses.push({ t: dir === 1 ? 0 : 1, dir });
            }
          }
        }

        // Pulses (advance on front pass, draw on matching hemisphere).
        // Travel speed scales gently with co-use volume — busier links flow faster.
        const cn = lk.count / (this.layout.maxCount || 1);
        const speed = 0.00016 * (0.55 + 0.45 * cn);
        for (let i = lk.pulses.length - 1; i >= 0; i--) {
          const p = lk.pulses[i];
          if (frontPass) {
            p.t += p.dir * speed * dt * ts;
            if (p.t < 0 || p.t > 1) { lk.pulses.splice(i, 1); continue; }
          }
          // Sample arc at p.t (interpolate projected points).
          const f = p.t * (proj.length - 1);
          const i0 = Math.max(0, Math.min(proj.length - 1, Math.floor(f)));
          const i1 = Math.min(proj.length - 1, i0 + 1);
          const fr = f - i0;
          const a0 = proj[i0], a1 = proj[i1];
          const nz = a0.nz + (a1.nz - a0.nz) * fr;
          if ((nz >= 0) !== frontPass) continue;
          const px = a0.x + (a1.x - a0.x) * fr;
          const py = a0.y + (a1.y - a0.y) * fr;
          // Offset each direction into its own lane so the two-way flow reads
          // as parallel traffic rather than pulses colliding on one line.
          const tx = a1.x - a0.x, ty = a1.y - a0.y;
          const tl = Math.hypot(tx, ty) || 1;
          const lane = 2.4 * p.dir;
          const ox = -ty / tl * lane;
          const oy = tx / tl * lane;
          const fade = Math.sin(p.t * Math.PI) * (0.5 + 0.5 * ((nz + 1) / 2));
          // Match the surface: back-hemisphere pulses 30% fainter (eased out when flat).
          const pulseBackDim = nz < 0 ? (0.7 + 0.3 * this.flat) : 1;
          ctx.save();
          ctx.globalCompositeOperation = theme.light ? 'source-over' : 'screen';
          ctx.shadowBlur = 12 * (1 + w);
          ctx.shadowColor = theme.pulse;
          ctx.fillStyle = theme.pulse;
          ctx.globalAlpha = fade * (dim ? 0.25 : 0.95) * linkVis * pulseBackDim;
          ctx.beginPath();
          ctx.arc(px + ox, py + oy, (2 + w * 2.2) * (this.opts.pulseSize != null ? this.opts.pulseSize : 1), 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }
    }

    // ── Clusters & neurons ──────────────────────────────────────────────────
    drawClusters(t, theme, frontPass) {
      // Depth-sort so nearer clusters draw last within each pass.
      const items = this.layout.groups.map((g) => {
        const rv = this.rotateVec(g.dir, this.rot.x, this.rot.y);
        return { g, rv, nz: rv[2] };
      }).filter((it) => (it.nz >= 0) === frontPass)
        .sort((a, b) => a.nz - b.nz);

      for (const it of items) this.drawCluster(it.g, it.rv, t, theme);
    }

    drawCluster(g, rv, t, theme) {
      const ctx = this.ctx;
      const center = this.project(rv);
      const z = center.scale;
      const shape = this.opts.clusterShape;
      const usage = g.usage;
      const dead = usage <= 0;
      const isHover = this.hovered && this.hovered.id === g.id;
      const isFocused = this.opts.focusedId === g.id;
      const matched = this.searchMatch ? this.searchMatch(g) : true;
      const dimmed = this.searchMatch && !matched;
      const vis = g.vis === undefined ? 1 : g.vis;
      if (vis < 0.01) return; // hidden by focus mode
      const depthFade = center.depthFade * vis; // back hemisphere + focus fade
      const grPx = g.groupR * this.sphereR;

      // Aura / halo
      if (!dead && (shape === 'halo' || shape === 'blob')) {
        const auraR = grPx * z * (shape === 'blob' ? 1.6 : 2.4);
        const vu = 0.35 + 0.65 * usage; // floor so low-usage nodes still glow
        const auraGrad = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, auraR);
        auraGrad.addColorStop(0, glowColorAlpha(theme, g, 0.32 * vu * depthFade));
        auraGrad.addColorStop(0.6, glowColorAlpha(theme, g, 0.08 * vu * depthFade));
        auraGrad.addColorStop(1, glowColorAlpha(theme, g, 0));
        ctx.save();
        ctx.globalCompositeOperation = theme.light ? 'multiply' : 'lighter';
        ctx.globalAlpha = (dimmed ? 0.2 : 1) * vis;
        ctx.fillStyle = auraGrad;
        ctx.beginPath();
        ctx.arc(center.x, center.y, auraR, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Outline (ring / blob)
      if (shape === 'ring' || shape === 'blob') {
        ctx.save();
        ctx.globalAlpha = (dimmed ? 0.2 : (dead ? 0.4 : 0.55)) * depthFade;
        ctx.lineWidth = isFocused || isHover ? 1.4 : 0.8;
        ctx.strokeStyle = dead ? theme.dead : theme.dim;
        ctx.setLineDash(dead ? [2, 4] : []);
        if (shape === 'ring') {
          ctx.beginPath();
          ctx.arc(center.x, center.y, grPx * z * 1.15, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          const segs = 18;
          ctx.beginPath();
          for (let i = 0; i <= segs; i++) {
            const a = (i / segs) * Math.PI * 2;
            const wob = Math.sin(t * 0.4 + i * 0.7 + g.breathPhase) * 0.16;
            const r = grPx * z * (1.18 + wob);
            const x = center.x + Math.cos(a) * r;
            const y = center.y + Math.sin(a) * r;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.stroke();
        }
        ctx.restore();
        ctx.setLineDash([]);
      }

      // Neurons — placed in the tangent plane, lifted just above the surface.
      const brightness = usage;
      ctx.save();
      ctx.globalAlpha = (dimmed ? 0.25 : 1) * depthFade;
      for (const nu of g.neurons) {
        const breath = 1 + Math.sin(t * 1.4 + nu.phase) * 0.15 * usage;
        // World point: dir lifted out + tangent offset, then renormalize to hug surface.
        const off = [
          g.dir[0] + (g.u[0] * nu.ox + g.v[0] * nu.oy),
          g.dir[1] + (g.u[1] * nu.ox + g.v[1] * nu.oy),
          g.dir[2] + (g.u[2] * nu.ox + g.v[2] * nu.oy),
        ];
        const nv = norm(off);
        const rvn = this.rotateVec(nv, this.rot.x, this.rot.y);
        const p = this.project(rvn);
        const r = nu.size * z * 0.95 * breath;
        ctx.fillStyle = neuronColor(theme, g, brightness);
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    drawLabels(theme) {
      const ctx = this.ctx;
      const focusedId = this.opts.focusedId;

      // Phase 1 — collect visible labels with their boxes.
      const labels = [];
      for (const g of this.layout.groups) {
        const rv = this.rotateVec(g.dir, this.rot.x, this.rot.y);
        if (rv[2] < 0.05 && this.flat < 0.5) continue; // only front-facing labels (3D)
        const vis = g.vis === undefined ? 1 : g.vis;
        if (vis < 0.35) continue; // suppressed by focus mode
        const center = this.project(rv);
        const isHover = this.hovered && this.hovered.id === g.id;
        const isFocus = focusedId === g.id;
        const matched = this.searchMatch ? this.searchMatch(g) : false;
        const showAlways = g.usage > 0.55 || this.opts.alwaysLabels;
        if (!showAlways && !isHover && !isFocus && !matched) continue;

        const dimmed = this.searchMatch && !matched && !isHover && !isFocus;
        const facing = Math.max(this.flat, 0.4 + 0.6 * rv[2]);
        const bold = isFocus || isHover;
        ctx.font = `${bold ? '600' : '500'} 11px ui-sans-serif,system-ui,sans-serif`;
        const w = ctx.measureText(displayName(g.name)).width;
        labels.push({
          g, center, isHover, isFocus, dimmed, facing, bold, w,
          cx: center.x,
          y: center.y + g.groupR * this.sphereR * center.scale + 12,
          h: 16,
          priority: (isFocus ? 3 : 0) + (isHover ? 2 : 0) + g.usage,
        });
      }

      // Phase 2 — resolve vertical overlaps (strength scales with flatten).
      if (this.flat > 0.15 && labels.length > 1) {
        const pad = 6, gap = 3;
        labels.sort((a, b) => a.y - b.y || b.priority - a.priority);
        for (let i = 0; i < labels.length; i++) {
          for (let j = 0; j < i; j++) {
            const a = labels[j], b = labels[i];
            const ax0 = a.cx - a.w / 2 - pad, ax1 = a.cx + a.w / 2 + pad;
            const bx0 = b.cx - b.w / 2 - pad, bx1 = b.cx + b.w / 2 + pad;
            const xOverlap = ax0 < bx1 && bx0 < ax1;
            const aBottom = a.y + a.h + (a.g.usage > 0 ? 5 : 0);
            if (xOverlap && b.y < aBottom + gap) {
              const shift = (aBottom + gap - b.y) * this.flat;
              b.y += shift;
            }
          }
        }
      }

      // Phase 3 — draw.
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (const L of labels) {
        const { g, cx, y, h, dimmed, facing, isFocus, isHover, w } = L;
        ctx.save();
        ctx.font = `${L.bold ? '600' : '500'} 11px ui-sans-serif,system-ui,sans-serif`;
        const pad = 6;
        const x0 = cx - w / 2 - pad;
        ctx.fillStyle = theme.light ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.55)';
        ctx.globalAlpha = (dimmed ? 0.3 : (isFocus || isHover ? 1 : 0.85)) * facing;
        roundRect(ctx, x0, y - 2, w + pad * 2, h, 4);
        ctx.fill();
        ctx.fillStyle = theme.ink;
        ctx.fillText(displayName(g.name), cx, y);

        if (g.usage > 0) {
          const barW = 28;
          ctx.fillStyle = theme.dim;
          ctx.globalAlpha = (dimmed ? 0.25 : 0.6) * facing;
          ctx.fillRect(cx - barW / 2, y + h + 2, barW, 1.5);
          ctx.fillStyle = theme.pulse;
          ctx.globalAlpha = (dimmed ? 0.4 : 1) * (0.55 + g.usage * 0.45) * facing;
          ctx.fillRect(cx - barW / 2, y + h + 2, barW * g.usage, 1.5);
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
        autoRotate: props.autoRotate,
        wireframe: props.wireframe,
        showGlobe: props.showGlobe,
        globeOpacity: props.globeOpacity,
        pulseSize: props.pulseSize,
        flat: props.flat,
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

    useEffect(() => {
      const r = rendererRef.current; if (!r) return;
      r.setOpts({
        theme: props.theme,
        clusterShape: props.clusterShape,
        density: props.density,
        alwaysLabels: props.alwaysLabels,
        autoRotate: props.autoRotate,
        wireframe: props.wireframe,
        showGlobe: props.showGlobe,
        globeOpacity: props.globeOpacity,
        pulseSize: props.pulseSize,
        flat: props.flat,
        focusedId: props.focusedId,
        onClick: props.onClick,
        onClickBg: props.onClickBg,
      });
      r.recenter();
    }, [props.theme, props.clusterShape, props.density, props.alwaysLabels, props.autoRotate, props.wireframe, props.showGlobe, props.globeOpacity, props.pulseSize, props.flat, props.focusedId, props.onClick, props.onClickBg]);

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
