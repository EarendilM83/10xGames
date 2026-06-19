import { useState, useEffect } from 'react'
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

export default function App() {
  const routeId = useHashId()
  const active = getGame(routeId)
  const [cfg, setCfg] = useState(getAutoplay)
  const [, tick] = useState(0)

  // Refresh the live win-rate readout in the game bar as autoplay sessions complete.
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => tick((x) => x + 1), 1500)
    return () => clearInterval(t)
  }, [active])

  const update = (next) => { setCfg(next); setAutoplay(next) }
  const toggleEnabled = () => update({ ...cfg, enabled: !cfg.enabled })
  const toggleArm = (id) =>
    update({ ...cfg, ids: cfg.ids.includes(id) ? cfg.ids.filter((x) => x !== id) : [...cfg.ids, id] })
  const armAll = () => update({ ...cfg, ids: games.map((g) => g.id) })
  const clearArmed = () => update({ ...cfg, ids: [] })

  useEffect(() => {
    document.title = active ? `${active.title} · 10x Games` : '10x Games'
  }, [active])

  if (active) {
    const GameComponent = active.component
    const auto = isAutoplay(active.id)
    return (
      <div className="game-view">
        <header className="game-bar">
          <a className="back-btn" href="#/">← All games</a>
          <span className="game-bar-title">{active.emoji} {active.title}</span>
          <span className="game-cat">{active.category}</span>
          {auto && <span className="auto-live">● AUTOPLAY</span>}
          {auto && getWinRate(active.id) != null && (
            <span className="auto-rate">WIN {Math.round(getWinRate(active.id) * 100)}%</span>
          )}
          <span className="brand-mini">10x</span>
        </header>
        <main className="game-stage">
          <GameComponent accent={active.accent} />
        </main>
      </div>
    )
  }

  return (
    <div className="home">
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
            ? `${cfg.ids.length} armed — open armed games in their own windows; they play themselves (random win/loss).`
            : 'Turn on, then arm the games you want to self-play across your screens.'}
        </span>
        <button className="ap-mini" onClick={armAll}>Arm all</button>
        <button className="ap-mini" onClick={clearArmed}>Clear</button>
      </div>

      {categories.map((cat) => {
        const list = games.filter((g) => g.category === cat)
        if (!list.length) return null
        return (
          <section className="cat" key={cat}>
            <h2 className="cat-title">{cat} <span className="cat-count">{list.length}</span></h2>
            <div className="grid">
              {list.map((g) => {
                const armed = cfg.ids.includes(g.id)
                return (
                  <a
                    key={g.id}
                    className={`card${cfg.enabled && armed ? ' armed' : ''}`}
                    href={`#/${g.id}`}
                    style={{ '--accent': g.accent }}
                  >
                    <div className="card-emoji">{g.emoji}</div>
                    <div className="card-title">{g.title}</div>
                    <div className="card-tagline">{g.tagline}</div>
                    <div className="card-foot">
                      <span className="card-play">Play ▶</span>
                      <button
                        className={`card-arm${armed ? ' on' : ''}`}
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleArm(g.id) }}
                        title="Arm for autoplay"
                      >
                        {armed ? '● AUTO' : 'AUTO'}
                      </button>
                    </div>
                  </a>
                )
              })}
            </div>
          </section>
        )
      })}

      <footer className="home-foot">10x · ღია კარის დღე · 2026</footer>
    </div>
  )
}
