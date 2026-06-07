// app.jsx — OpenClaw plugin network — main app shell

(function () {
  const { useState, useEffect, useRef, useMemo, useCallback } = React;

  const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
    "clusterShape": "halo",
    "alwaysLabels": false,
    "autoRotate": true,
    "wireframe": true,
    "showGlobe": true,
    "globeOpacity": 1,
    "flat2d": false,
    "animSpeed": 0.75,
    "pulseSize": 1
  } /*EDITMODE-END*/;

  // ─── Tooltip ──────────────────────────────────────────────────────────────
  function Tooltip({ data }) {
    if (!data || !data.plugin) return null;
    const p = data.plugin;
    const pct = Math.round(p.usage * 100);
    const calls = p.calls ?? 0;
    return (
      <div className="oc-tooltip" style={{ left: data.x + 14, top: data.y + 14 }}>
        <div className="oc-tt-name">{p.name}</div>
        <div className="oc-tt-bar"><div style={{ width: pct + '%' }} /></div>
        <div className="oc-tt-meta">
          <span>{p.usage > 0 ? `${calls} appels · ${p.turns ?? 0} tours` : 'inactive'}</span>
          <span>·</span>
          <span>{(window.__OC_META__?.windowDays) || 30}j</span>
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
                <span className="oc-search-row-name">{s.name}</span>
                <span className="oc-search-row-meta">{s.files.length} files · {Math.round(s.usage * 100)}%</span>
              </button>
          )}
          </div>
        }
      </div>);

  }

  // ─── Header / brand ───────────────────────────────────────────────────────
  function Header({ theme }) {
    return (
      <div className="oc-header">
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
      </div>);

  }

  // ─── Side panel ───────────────────────────────────────────────────────────
  function SidePanel({ plugins, hovered, focused, onFocus, totalCalls }) {
    const sorted = useMemo(
      () => [...plugins].sort((a, b) => b.usage - a.usage),
      [plugins]
    );
    const active = plugins.filter((p) => p.usage > 0).length;
    const dead = plugins.length - active;
    const calls = (p) => p.calls ?? 0;

    return (
      <aside className="oc-side">
        <div className="oc-side-section">
          <div className="oc-side-label">LAST {(window.__OC_META__?.windowDays) || 30} DAYS</div>
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
                  title={`${p.name} — ${calls(p)} calls`}>
                  
                  <span className="oc-row-dot" data-idx={p._idx} />
                  <span className="oc-row-name">{p.name}</span>
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
    // Directional ratio: of the turns where THIS node was used, the share that
    // also involved the other node. count = coTurns (l[3]); plugin.turns is this
    // node's distinct-turn count. Ratios can overlap (a turn may involve 3+ tools).
    const connected = (links || []).
    filter((l) => l[0] === plugin.id || l[1] === plugin.id).
    map((l) => {
      const count = l[3] || 0;
      return {
        other: l[0] === plugin.id ? l[1] : l[0],
        count,
        ratio: plugin.turns ? count / plugin.turns : 0
      };
    }).
    sort((a, b) => b.count - a.count);
    const otherName = (id) => (window.PLUGINS.find((p) => p.id === id) || {}).name || id;

    return (
      <div className="oc-focus">
        <div className="oc-focus-head">
          <div>
            <div className="oc-focus-eyebrow">Plugin</div>
            <div className="oc-focus-name">{plugin.name}</div>
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
            <div className="oc-focus-stat-key">Appels · 30j</div>
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
          <div className="oc-focus-label">Used alongside</div>
          {connected.filter((c) => c.count > 0).length === 0 ?
          <div className="oc-focus-empty">No cross-plugin traffic in this window.</div> :

          <ul className="oc-conns">
              {connected.filter((c) => c.count > 0).map((c) =>
            <li key={c.other}>
                  <button onClick={() => onFocus(c.other)}>
                    <span className="oc-conn-name">{otherName(c.other)}</span>
                    <span className="oc-conn-meter"><span style={{ width: Math.min(100, c.ratio * 100) + '%' }} /></span>
                    <span className="oc-conn-pct">{Math.round(c.ratio * 100)}%</span>
                  </button>
                </li>
            )}
            </ul>
          }
          <div className="oc-focus-foot">Part des tours de « {plugin.name} » impliquant aussi l'autre nœud. Un tour pouvant impliquer plusieurs nœuds, ces % ne somment pas à 100.</div>
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

    // Real total tool-call count from the snapshot aggregation.
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
        
        <Header />
        <SearchBar
          value={search} onChange={setSearch}
          suggestions={suggestions}
          onPick={(id) => {setFocusedId(id);setSearch('');}} />
        
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