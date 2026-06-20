import { useState, useEffect, useMemo } from 'react'
import { games, getGame, categories } from './games/index.js'
import { getAutoplay, setAutoplay, isAutoplay, getWinRate, setForceAutoplay } from './autoplay.js'
import Starfield from './landing/Starfield.jsx'
import HeroOrb from './landing/HeroOrb.jsx'
import Sigil from './landing/Sigil.jsx'
import Wall from './landing/Wall.jsx'

// Hash-based routing so every game has its own URL (#/<id>) — shareable & open-in-new-tab.
function useHashId() {
  const read = () => (window.location.hash.replace(/^#\/?/, '').split('?')[0])
  const [id, setId] = useState(read)
  useEffect(() => {
    const on = () => setId(read())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return id
}

const LS = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch { return d } }
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* ignore */ } }
const PAGE_SIZES = [12, 24, 48, 'All']

export default function App() {
  const routeId = useHashId()
  const isWall = routeId === 'wall'
  const active = isWall ? null : getGame(routeId)
  // Deterministic from the route; runs before child game effects so wall tiles self-play.
  setForceAutoplay(isWall)
  const [cfg, setCfg] = useState(getAutoplay)
  const [, tick] = useState(0)

  const [query, setQuery] = useState('')
  const [cat, setCat] = useState(() => LS('10xgames.ui.cat', 'All'))
  const [layout, setLayout] = useState(() => LS('10xgames.ui.layout', 'grid'))
  const [pageSize, setPageSize] = useState(() => {
    const v = LS('10xgames.ui.pageSize', 12)
    return PAGE_SIZES.includes(v) ? v : 12
  })
  const [page, setPage] = useState(1)

  useEffect(() => { save('10xgames.ui.cat', cat) }, [cat])
  useEffect(() => { save('10xgames.ui.layout', layout) }, [layout])
  useEffect(() => { save('10xgames.ui.pageSize', pageSize) }, [pageSize])
  useEffect(() => { setPage(1) }, [query, cat, pageSize])

  const update = (next) => { setCfg(next); setAutoplay(next) }
  const toggleEnabled = () => update({ ...cfg, enabled: !cfg.enabled })
  const toggleArm = (id) =>
    update({ ...cfg, ids: cfg.ids.includes(id) ? cfg.ids.filter((x) => x !== id) : [...cfg.ids, id] })
  const armAll = () => update({ ...cfg, ids: games.map((g) => g.id) })
  const clearArmed = () => update({ ...cfg, ids: [] })

  useEffect(() => {
    if (!active) return
    const t = setInterval(() => tick((x) => x + 1), 1500)
    return () => clearInterval(t)
  }, [active])

  useEffect(() => {
    document.title = active ? `${active.title} · 10x Games` : '10x Games'
  }, [active])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return games.filter((g) =>
      (cat === 'All' || g.category === cat) &&
      (!q || g.title.toLowerCase().includes(q) || g.tagline.toLowerCase().includes(q) || g.category.toLowerCase().includes(q))
    )
  }, [query, cat])

  const size = pageSize === 'All' ? filtered.length || 1 : pageSize
  const totalPages = Math.max(1, Math.ceil(filtered.length / size))
  const curPage = Math.min(page, totalPages)
  const pageItems = filtered.slice((curPage - 1) * size, curPage * size)

  // ---------- demo wall ----------
  if (isWall) return <Wall />

  // ---------- game view ----------
  if (active) {
    const GameComponent = active.component
    const auto = isAutoplay(active.id)
    const rate = auto ? getWinRate(active.id) : null
    return (
      <div className="game-view">
        <Starfield />
        <header className="game-bar">
          <a className="back-btn" href="#/">← All games</a>
          <span className="game-bar-title">{active.title}</span>
          <span className="game-cat">{active.category}</span>
          {auto && <span className="auto-live">demo</span>}
          {rate != null && <span className="auto-rate">{Math.round(rate * 100)}% win</span>}
          <span className="brand-mini">10x</span>
        </header>
        <main className="game-stage">
          <GameComponent accent={active.accent} />
        </main>
      </div>
    )
  }

  // ---------- home ----------
  return (
    <div className="home">
      <Starfield />

      <header className="topbar">
        <a className="logo" href="#/"><b>10x</b><span>games</span></a>
        <span className="topbar-tag">Open Door Day · Front-End</span>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">An arcade, built in the browser</p>
          <h1 className="hero-title">Play<br />the <span className="accent">web.</span></h1>
          <p className="hero-lead">{games.length} games written in React &amp; Canvas — pick one and play, or open any in its own window.</p>
          <div className="hero-meta">
            <span><b>{games.length}</b> games</span>
            <span><b>{categories.length}</b> categories</span>
            <span><b>0kb</b> installs</span>
          </div>
        </div>
        <div className="hero-art"><HeroOrb /></div>
      </section>

      <div className="demo-strip">
        <label className={`switch${cfg.enabled ? ' on' : ''}`}>
          <input type="checkbox" checked={cfg.enabled} onChange={toggleEnabled} />
          <span className="switch-track"><span className="switch-knob" /></span>
          Demo mode
        </label>
        <span className="demo-hint">
          {cfg.enabled
            ? `${cfg.ids.length} game${cfg.ids.length === 1 ? '' : 's'} armed — open them in their own windows and they play themselves.`
            : 'Let games play themselves across your screens, hands-free.'}
        </span>
        <div className="demo-actions">
          <button onClick={armAll}>Arm all</button>
          <button onClick={clearArmed}>Clear</button>
          <a className="wall-link" href="#/wall">Open demo wall ↗</a>
        </div>
      </div>

      <div className="toolbar">
        <div className="tabs">
          {['All', ...categories].map((c) => (
            <button key={c} className={`tab${cat === c ? ' on' : ''}`} onClick={() => setCat(c)}>{c}</button>
          ))}
        </div>
        <div className="tools">
          <input className="search" type="text" placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="seg">
            <button className={`seg-btn${layout === 'grid' ? ' on' : ''}`} onClick={() => setLayout('grid')} aria-label="Grid">▦</button>
            <button className={`seg-btn${layout === 'list' ? ' on' : ''}`} onClick={() => setLayout('list')} aria-label="List">≡</button>
          </div>
          <select className="page-size" value={pageSize} onChange={(e) => setPageSize(e.target.value === 'All' ? 'All' : Number(e.target.value))}>
            {PAGE_SIZES.map((s) => <option key={s} value={s}>{s === 'All' ? 'All' : `${s}/pg`}</option>)}
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="empty">Nothing matches “{query}”.</p>
      ) : (
        <div className={layout === 'grid' ? 'grid' : 'list'} key={`${cat}-${curPage}-${layout}`}>
          {pageItems.map((g, i) => {
            const armed = cfg.ids.includes(g.id)
            return (
              <a
                key={g.id}
                className={`card${cfg.enabled && armed ? ' armed' : ''}`}
                href={`#/${g.id}`}
                style={{ '--accent': g.accent, animationDelay: `${Math.min(i, 14) * 0.03}s` }}
              >
                <div className="card-head">
                  <Sigil id={g.id} accent={g.accent} />
                  <div className="card-id">
                    <span className="card-title">{g.title}</span>
                    <span className="card-tag">{g.category}</span>
                  </div>
                </div>
                <p className="card-desc">{g.tagline}</p>
                <div className="card-row">
                  <span className="card-play">Play →</span>
                  <button
                    className={`card-arm${armed ? ' on' : ''}`}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleArm(g.id) }}
                  >
                    {armed ? 'auto ✓' : 'auto'}
                  </button>
                </div>
              </a>
            )
          })}
        </div>
      )}

      {totalPages > 1 && (
        <nav className="pager">
          <button className="pg" disabled={curPage === 1} onClick={() => setPage(curPage - 1)}>‹</button>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <button key={p} className={`pg num${p === curPage ? ' on' : ''}`} onClick={() => setPage(p)}>{p}</button>
          ))}
          <button className="pg" disabled={curPage === totalPages} onClick={() => setPage(curPage + 1)}>›</button>
        </nav>
      )}
      <p className="result-count">
        {filtered.length === 0 ? 0 : (curPage - 1) * size + 1}–{Math.min(curPage * size, filtered.length)} of {filtered.length}
      </p>

      <footer className="home-foot">
        <span>10x · ღია კარის დღე</span>
        <span>React + Canvas · 2026</span>
      </footer>
    </div>
  )
}
