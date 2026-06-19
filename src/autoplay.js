// Autoplay / demo-mode coordination, shared across browser windows via localStorage.
// A game runs itself when: URL hash has ?auto=1, OR (master enabled AND this game is armed).
// ?auto=0 forces it off. Used by the landing page (controls) and every game (reads isAutoplay).

const KEY = '10xgames.autoplay'

export function getAutoplay() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY))
    if (v && typeof v === 'object') return { enabled: !!v.enabled, ids: Array.isArray(v.ids) ? v.ids : [] }
  } catch { /* ignore */ }
  return { enabled: false, ids: [] }
}

export function setAutoplay(cfg) {
  localStorage.setItem(KEY, JSON.stringify({ enabled: !!cfg.enabled, ids: cfg.ids || [] }))
}

// Parse the ?query that may follow the hash route, e.g. "#/snake?auto=1".
function hashParam(name) {
  const h = window.location.hash || ''
  const qi = h.indexOf('?')
  if (qi < 0) return null
  return new URLSearchParams(h.slice(qi + 1)).get(name)
}

export function isAutoplay(id) {
  const p = hashParam('auto')
  if (p === '1') return true
  if (p === '0') return false
  const cfg = getAutoplay()
  return cfg.enabled && cfg.ids.includes(id)
}

// ---- per-game autoplay win-rate tracking + 95% target controller ----
const STATS_KEY = '10xgames.autoplay.stats'
const TARGET = 0.95

function allStats() {
  try { return JSON.parse(localStorage.getItem(STATS_KEY)) || {} } catch { return {} }
}
function saveStats(s) { try { localStorage.setItem(STATS_KEY, JSON.stringify(s)) } catch { /* ignore */ } }

// Per-game win rate (0..1), or null if no sessions recorded yet.
export function getWinRate(id) {
  const s = allStats()[id]
  if (!s || !s.sessions) return null
  return s.wins / s.sessions
}
export function getWinStats(id) {
  return allStats()[id] || { sessions: 0, wins: 0 }
}

// Record a finished autoplay session for a game.
export function recordAutoplayResult(id, won) {
  const all = allStats()
  const s = all[id] || { sessions: 0, wins: 0 }
  s.sessions += 1
  if (won) s.wins += 1
  all[id] = s
  saveStats(all)
}

// Decide whether the NEXT autoplay round should aim to win — self-corrects to ~95% per game.
// Robust to imperfect bots: a missed win pushes the next rounds toward winning, and vice versa.
export function shouldAutoWin(id) {
  const s = allStats()[id] || { sessions: 0, wins: 0 }
  if (s.sessions < 8) return true            // open with a clean winning streak (smooth start)
  return (s.wins / s.sessions) <= TARGET      // hold the cumulative rate at ~95%
}
