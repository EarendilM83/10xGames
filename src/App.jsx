import { useState, useEffect, useMemo } from 'react'
import { games, getGame, categories } from './games/index.js'
import { getAutoplay, setAutoplay, isAutoplay, getWinRate } from './autoplay.js'

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
  const active = getGame(routeId)
  const [cfg, setCfg] = useState(getAutoplay)
  const [, tick] = useState(0)

  // home controls
  const [query, setQuery] = useState('')
  const [cat, setCat] = useState(() => LS('10xgames.ui.cat', 'All'))
  const [layout, setLayout] = useState(() => LS('10xgames.ui.layout', 'grid'))
  const [pageSize, setPageSize] = useState(() => LS('10xgames.ui.pageSize', 12))
  const [page, setPage] = useState(1)

  useEffect(() => { save('10xgames.ui.cat', cat) }, [cat])
  useEffect(() => { save('10xgames.ui.layout', layout) }, [layout])
  useEffect(() => { save('10xgames.ui.pageSize', pageSize) }, [pageSize])
  useEffect(() => { setPage(1) }, [query, cat, pageSize]) // reset to first page on filter change

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

  // ---------- game view ----------
  if (active) {
    const GameComponent = active.component
    const auto = isAutoplay(active.id)
    const rate = auto ? getWinRate(active.id) : null
    return (
      <div className="game-view">
        <div className="cosmos" aria-hidden />
        <header className="game-bar">
          <a className="back-btn" href="#/">← All games</a>
          <span className="game-bar-title">{active.emoji} {active.title}</span>
          <span className="game-cat">{active.category}</span>
          {auto && <span className="auto-live">● AUTOPLAY</span>}
          {rate != null && <span className="auto-rate">WIN {Math.round(rate * 100)}%</span>}
          <span className="brand-mini">10x</span>
        </header>
        <main className="game-stage">
          <GameComponent accent={active.accent} />
        </main>
      </div>
    )
  }

  // ---------- home ----------
  const chips = ['All', ...categories]
  return (
    <div className="home">
      <div className="cosmos" aria-hidden />
      <header className="hero">
        <div className="brand">
          <span className="brand-x">10x</span>
          <span className="brand-word">Games</span>
        </div>
        <p className="hero-sub">Open Door Day · <b>Front-End</b> demos you can play</p>
        <p className="hero-count">{games.length} games · click to play · open any in a new tab</p>
      </header>

      <div className={`autoplay-bar${cfg.enabled ? ' on' : ''}`}>
        <button className={`ap-toggle${cfg.enabled ? ' on' : ''}`} onClick={toggleEnabled}>
          <span className="ap-dot" /> Autoplay {cfg.enabled ? 'ON' : 'OFF'}
        </button>
        <span className="ap-hint">
          {cfg.enabled
            ? `${cfg.ids.length} armed — open armed games in their own windows; they play themselves (~95% win).`
            : 'Turn on, then arm the games you want to self-play across your screens.'}
        </span>
        <button className="ap-mini" onClick={armAll}>Arm all</button>
        <button className="ap-mini" onClick={clearArmed}>Clear</button>
      </div>

      <div className="controls">
        <input
          className="search"
          type="text"
          placeholder="Search games…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="chips">
          {chips.map((c) => (
            <button key={c} className={`chip${cat === c ? ' on' : ''}`} onClick={() => setCat(c)}>{c}</button>
          ))}
        </div>
        <div className="control-right">
          <div className="seg" role="group" aria-label="Layout">
            <button className={`seg-btn${layout === 'grid' ? ' on' : ''}`} onClick={() => setLayout('grid')} title="Grid">▦</button>
            <button className={`seg-btn${layout === 'list' ? ' on' : ''}`} onClick={() => setLayout('list')} title="List">▤</button>
          </div>
          <select className="page-size" value={pageSize} onChange={(e) => setPageSize(e.target.value === 'All' ? 'All' : Number(e.target.value))}>
            {PAGE_SIZES.map((s) => <option key={s} value={s}>{s === 'All' ? 'All' : `${s} / page`}</option>)}
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="empty">No games match “{query}”.</p>
      ) : (
        <div className={layout === 'grid' ? 'grid' : 'list'} key={`${cat}-${curPage}-${layout}`}>
          {pageItems.map((g, i) => {
            const armed = cfg.ids.includes(g.id)
            return (
              <a
                key={g.id}
                className={`card${cfg.enabled && armed ? ' armed' : ''}`}
                href={`#/${g.id}`}
                style={{ '--accent': g.accent, animationDelay: `${Math.min(i, 12) * 0.035}s` }}
              >
                <div className="card-emoji">{g.emoji}</div>
                <div className="card-body">
                  <div className="card-title">{g.title}</div>
                  <div className="card-tagline">{g.tagline}</div>
                  <div className="card-foot">
                    <span className="card-play">Play ▶</span>
                    <span className="card-cat-tag">{g.category}</span>
                    <button
                      className={`card-arm${armed ? ' on' : ''}`}
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleArm(g.id) }}
                      title="Arm for autoplay"
                    >
                      {armed ? '● AUTO' : 'AUTO'}
                    </button>
                  </div>
                </div>
              </a>
            )
          })}
        </div>
      )}

      {totalPages > 1 && (
        <nav className="pager">
          <button className="pg" disabled={curPage === 1} onClick={() => setPage(curPage - 1)}>‹ Prev</button>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <button key={p} className={`pg num${p === curPage ? ' on' : ''}`} onClick={() => setPage(p)}>{p}</button>
          ))}
          <button className="pg" disabled={curPage === totalPages} onClick={() => setPage(curPage + 1)}>Next ›</button>
        </nav>
      )}
      <p className="result-count">
        Showing {filtered.length === 0 ? 0 : (curPage - 1) * size + 1}–{Math.min(curPage * size, filtered.length)} of {filtered.length}
      </p>

      <footer className="home-foot">10x · ღია კარის დღე · 2026</footer>
    </div>
  )
}
