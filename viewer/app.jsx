// app.jsx — OpenClaw plugin network — main app shell

(function () {
  const { useState, useEffect, useRef, useMemo, useCallback } = React;

  // Strip the "skill:" prefix for display only (ids/search keep the full name).
  const stripSkill = (name) => (name || '').replace(/^skill:\s*/i, '');

  const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
    "clusterShape": "halo",
    "alwaysLabels": true,
    "autoRotate": true,
    "wireframe": false,
    "showGlobe": true,
    "globeOpacity": 0.45,
    "flat2d": false,
    "animSpeed": 0.75,
    "pulseSize": 0.5
  } /*EDITMODE-END*/;

  // ─── Tooltip ──────────────────────────────────────────────────────────────
  function Tooltip({ data }) {
    if (!data || !data.plugin) return null;
    const p = data.plugin;
    const pct = Math.round(p.usage * 100);
    const calls = p.calls ?? 0;
    const windowDays = window.__OC_META__?.windowDays || 30;
    return (
      <div className="oc-tooltip" style={{ left: data.x + 14, top: data.y + 14 }}>
        <div className="oc-tt-name">{stripSkill(p.name)}</div>
        <div className="oc-tt-bar"><div style={{ width: pct + '%' }} /></div>
        <div className="oc-tt-meta">
          <span>{p.usage > 0 ? `${calls} calls · ${windowDays}d` : 'inactive'}</span>
          <span>·</span>
          <span>activity {pct}/100</span>
        </div>
      </div>);

  }

  // ─── Search ───────────────────────────────────────────────────────────────
  function SearchBar({ value, onChange, suggestions, onPick }) {
    const [open, setOpen] = useState(false);
    return (
      <div className="oc-search">
        <div className="oc-search-box">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.3" />
            <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            placeholder="Search plugins or files…"
            value={value}
            onChange={(e) => {onChange(e.target.value);setOpen(true);}}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)} />
          
          {value &&
          <button className="oc-search-clear" onClick={() => onChange('')} aria-label="Clear">×</button>
          }
        </div>
        {open && value && suggestions.length > 0 &&
        <div className="oc-search-results">
            {suggestions.slice(0, 6).map((s) =>
          <button key={s.id} className="oc-search-row" onMouseDown={() => onPick(s.id)}>
                <span className="oc-search-row-name">{stripSkill(s.name)}</span>
                <span className="oc-search-row-meta">{s.files.length} files · {Math.round(s.usage * 100)}%</span>
              </button>
          )}
          </div>
        }
      </div>);

  }

  // ─── Header / brand ───────────────────────────────────────────────────────
  function Header({ flat, onToggle }) {
    return (
      <button
        type="button"
        className="oc-header oc-header-btn"
        onClick={onToggle}
        aria-pressed={!!flat}
        title={flat ? 'Vue 2D — cliquer pour revenir au globe' : 'Vue globe — cliquer pour passer en 2D'}>
        <div className="oc-logo">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="3" fill="currentColor" />
            <circle cx="4" cy="6" r="1.5" fill="currentColor" opacity="0.6" />
            <circle cx="20" cy="6" r="1.5" fill="currentColor" opacity="0.6" />
            <circle cx="4" cy="18" r="1.5" fill="currentColor" opacity="0.6" />
            <circle cx="20" cy="18" r="1.5" fill="currentColor" opacity="0.6" />
            <path d="M12 12 L4 6 M12 12 L20 6 M12 12 L4 18 M12 12 L20 18" stroke="currentColor" strokeWidth="0.6" opacity="0.4" />
          </svg>
        </div>
        <div className="oc-brand">
          <div className="oc-brand-title">OpenClaw</div>
          <div className="oc-brand-sub">Plugin Activity</div>
        </div>
        <span className="oc-view-toggle" aria-hidden="true">
          <span className={`oc-view-opt${!flat ? ' is-on' : ''}`}>Globe</span>
          <span className={`oc-view-opt${flat ? ' is-on' : ''}`}>2D</span>
        </span>
      </button>);

  }

  // ─── Side panel ───────────────────────────────────────────────────────────
  function SidePanel({ plugins, hovered, focused, onFocus, totalCalls }) {
    const sorted = useMemo(
      () => [...plugins].sort((a, b) => b.usage - a.usage),
      [plugins]
    );
    const active = plugins.filter((p) => p.usage > 0).length;
    const dead = plugins.length - active;
    const windowDays = window.__OC_META__?.windowDays || 30;
    const calls = (p) => p.calls ?? 0;

    return (
      <aside className="oc-side">
        <div className="oc-side-section">
          <div className="oc-side-label">SESSION · LAST {windowDays} DAYS</div>
          <div className="oc-side-stats">
            <div className="oc-stat">
              <div className="oc-stat-val">{plugins.length}</div>
              <div className="oc-stat-key">plugins</div>
            </div>
            <div className="oc-stat">
              <div className="oc-stat-val">{active}</div>
              <div className="oc-stat-key">active</div>
            </div>
            <div className="oc-stat oc-stat-dead">
              <div className="oc-stat-val">{dead}</div>
              <div className="oc-stat-key">dormant</div>
            </div>
            <div className="oc-stat">
              <div className="oc-stat-val">{totalCalls.toLocaleString()}</div>
              <div className="oc-stat-key">calls</div>
            </div>
          </div>
        </div>

        <div className="oc-side-section is-flex">
          <div className="oc-side-label" title="Activity score 0–100 — normalized share of session calls handled by this plugin">
            Activity score
          </div>
          <div className="oc-side-list">
            {sorted.map((p) => {
              const pct = Math.round(p.usage * 100);
              const isFocus = focused === p.id;
              const isHover = hovered && hovered.id === p.id;
              return (
                <button
                  key={p.id}
                  className={`oc-row${isFocus ? ' is-focus' : ''}${isHover ? ' is-hover' : ''}${p.usage === 0 ? ' is-dead' : ''}`}
                  onClick={() => onFocus(isFocus ? null : p.id)}
                  title={`${stripSkill(p.name)} — ${calls(p)} calls`}>

                  <span className="oc-row-dot" data-idx={p._idx} />
                  <span className="oc-row-name">{stripSkill(p.name)}</span>
                  <span className="oc-row-meter">
                    <span style={{ width: pct + '%' }} />
                  </span>
                  <span className="oc-row-pct">{p.usage === 0 ? '—' : pct}</span>
                </button>);

            })}
          </div>
        </div>


      </aside>);

  }

  // ─── Focus modal (plugin details on click) ─────────────────────────────────
  function FocusCard({ plugin, links, onClose, onFocus }) {
    if (!plugin) return null;
    const connected = (links || []).
    filter((l) => l[0] === plugin.id || l[1] === plugin.id).
    map((l) => ({
      other: l[0] === plugin.id ? l[1] : l[0],
      weight: l[2],
      count: l[3] || 0
    })).
    sort((a, b) => b.count - a.count);
    const maxCo = Math.max(1, ...connected.map((c) => c.count));
    const otherName = (id) => stripSkill((window.PLUGINS.find((p) => p.id === id) || {}).name || id);
    const windowDays = window.__OC_META__?.windowDays || 30;
    const kindLabel = (plugin.kind || 'plugin').replace(/^\w/, (c) => c.toUpperCase());

    return (
      <div className="oc-focus">
        <div className="oc-focus-head">
          <div>
            <div className="oc-focus-eyebrow">{kindLabel}</div>
            <div className="oc-focus-name">{stripSkill(plugin.name)}</div>
          </div>
          <button className="oc-focus-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <p className="oc-focus-desc">{plugin.desc}</p>

        <div className="oc-focus-row">
          <div className="oc-focus-stat">
            <div className="oc-focus-stat-val">{Math.round(plugin.usage * 100)}<span className="oc-focus-stat-unit">/100</span></div>
            <div className="oc-focus-stat-key" title="Normalized share of session calls handled by this plugin">Activity score</div>
          </div>
          <div className="oc-focus-stat">
            <div className="oc-focus-stat-val">{(plugin.calls ?? 0).toLocaleString()}</div>
            <div className="oc-focus-stat-key">Calls · {windowDays}d</div>
          </div>
          <div className="oc-focus-stat">
            <div className="oc-focus-stat-val">{(plugin.turns ?? 0).toLocaleString()}</div>
            <div className="oc-focus-stat-key">Turns</div>
          </div>
          <div className="oc-focus-stat">
            <div className="oc-focus-stat-val">{connected.filter((c) => c.count > 0).length}</div>
            <div className="oc-focus-stat-key">Peer plugins</div>
          </div>
        </div>

        <div className="oc-focus-section">
          <div className="oc-focus-label">Files <span className="oc-focus-count">{plugin.files.length}</span></div>
          <ul className="oc-files">
            {plugin.files.map((f) =>
            <li key={f}>
                <span className="oc-file-glyph">·</span>
                <code>{f}</code>
              </li>
            )}
          </ul>
        </div>

        <div className="oc-focus-section">
          <div className="oc-focus-label">Communicates with</div>
          {connected.filter((c) => c.count > 0).length === 0 ?
          <div className="oc-focus-empty">No cross-plugin traffic in this window.</div> :

          <ul className="oc-conns">
              {connected.filter((c) => c.count > 0).map((c) =>
            <li key={c.other}>
                  <button onClick={() => onFocus(c.other)}>
                    <span className="oc-conn-name">{otherName(c.other)}</span>
                    <span className="oc-conn-meter"><span style={{ width: c.count / maxCo * 100 + '%' }} /></span>
                    <span className="oc-conn-pct">{c.count}</span>
                  </button>
                </li>
            )}
            </ul>
          }
          <div className="oc-focus-foot">Co-uses — times the two skills were invoked together. Each becomes one pulse per 45s loop; pulses flow both ways since the order of use isn't recorded.</div>
        </div>
      </div>);

  }

  // ─── Tweaks panel content ─────────────────────────────────────────────────
  function TweakControls({ t, setTweak }) {
    return (
      <TweaksPanel>
        <TweakSection label="Display" />
        <TweakRadio
          label="Cluster shape"
          value={t.clusterShape}
          options={[
          { value: 'dots', label: 'Dots' },
          { value: 'halo', label: 'Halo' },
          { value: 'ring', label: 'Ring' },
          { value: 'blob', label: 'Blob' }]
          }
          onChange={(v) => setTweak('clusterShape', v)} />
        
        <TweakToggle
          label="Always show labels"
          value={t.alwaysLabels}
          onChange={(v) => setTweak('alwaysLabels', v)} />
        
        <TweakToggle
          label="Globe grid"
          value={t.wireframe}
          onChange={(v) => setTweak('wireframe', v)} />
        
        <TweakToggle
          label="Show globe body"
          value={t.showGlobe}
          onChange={(v) => setTweak('showGlobe', v)} />
        
        <TweakSlider
          label="Globe body opacity" value={t.globeOpacity}
          min={0} max={1} step={0.05} unit=""
          onChange={(v) => setTweak('globeOpacity', v)} />
        
        <TweakToggle
          label="Flatten to 2D map"
          value={t.flat2d}
          onChange={(v) => setTweak('flat2d', v)} />
        
        <TweakSection label="Motion" />
        <TweakToggle
          label="Auto-spin when idle"
          value={t.autoRotate}
          onChange={(v) => setTweak('autoRotate', v)} />
        
        <TweakSlider
          label="Animation speed" value={t.animSpeed}
          min={0.25} max={3} step={0.25} unit="×"
          onChange={(v) => setTweak('animSpeed', v)} />
        
        <TweakSlider
          label="Link pulse size" value={t.pulseSize}
          min={0.25} max={3} step={0.25} unit="×"
          onChange={(v) => setTweak('pulseSize', v)} />
        
      </TweaksPanel>);

  }

  // ─── Main App ─────────────────────────────────────────────────────────────
  function App() {
    const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
    const [hovered, setHovered] = useState(null);
    const [tooltip, setTooltip] = useState(null);
    const [focusedId, setFocusedId] = useState(null);
    const [search, setSearch] = useState('');

    const visiblePlugins = useMemo(() => {
      return window.PLUGINS.map((p, i) => ({ ...p, _idx: i }));
    }, []);

    // For renderer: filter LINKS to visible plugins
    const visibleLinks = useMemo(() => {
      const ids = new Set(visiblePlugins.map((p) => p.id));
      return window.LINKS.filter((l) => ids.has(l[0]) && ids.has(l[1]));
    }, [visiblePlugins]);
    const viewKey = visiblePlugins.length + ':' + visibleLinks.length;

    const onHover = useCallback((g, pt) => {
      setHovered(g);
      if (g && pt) setTooltip({ plugin: g, x: pt.x, y: pt.y });else
      setTooltip(null);
    }, []);

    const onClick = useCallback((g) => {
      setFocusedId(g.id);
    }, []);
    const onClickBg = useCallback(() => setFocusedId(null), []);

    const suggestions = useMemo(() => {
      const q = search.toLowerCase().trim();
      if (!q) return [];
      return window.PLUGINS.filter((p) =>
      p.name.toLowerCase().includes(q) ||
      p.short.toLowerCase().includes(q) ||
      p.files.some((f) => f.toLowerCase().includes(q))
      );
    }, [search]);

    // Global total comes straight from session metadata — never derived from usage
    const totalCalls = window.__OC_META__?.totalEvents ?? 0;

    const focusedPlugin = focusedId ? window.PLUGINS.find((p) => p.id === focusedId) : null;

    return (
      <div className="oc-app oc-theme-atlas">
        <NetworkCanvasGated
          plugins={visiblePlugins}
          links={visibleLinks}
          theme="atlas"
          clusterShape={t.clusterShape}
          density="regular"
          alwaysLabels={t.alwaysLabels}
          autoRotate={t.autoRotate}
          wireframe={t.wireframe}
          showGlobe={t.showGlobe}
          globeOpacity={t.globeOpacity}
          pulseSize={t.pulseSize}
          flat={t.flat2d}
          focusedId={focusedId}
          searchQuery={search}
          timeScale={t.animSpeed}
          onHover={onHover}
          onClick={onClick}
          onClickBg={onClickBg}
          viewKey={viewKey} />
        
        <Header flat={t.flat2d} onToggle={() => setTweak('flat2d', !t.flat2d)} />
        
        <SidePanel
          plugins={visiblePlugins}
          hovered={hovered}
          focused={focusedId}
          onFocus={setFocusedId}
          totalCalls={totalCalls} />
        
        {focusedPlugin &&
        <FocusCard
          plugin={focusedPlugin}
          links={window.LINKS}
          onClose={() => setFocusedId(null)}
          onFocus={(id) => setFocusedId(id)} />

        }
        <Tooltip data={tooltip && !focusedId ? tooltip : null} />
        <TweakControls t={t} setTweak={setTweak} />
      </div>);

  }

  // Gating wrapper: rebuild renderer when visible-plugin set changes
  function NetworkCanvasGated(props) {
    return (
      <NetworkCanvas
        key={'nc-' + props.viewKey}
        {...props} />);


  }

  window.OpenClawApp = App;
})();
