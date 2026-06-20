import { useEffect, useRef, useState } from 'react'
import { games, getGame } from '../games/index.js'

// Demo wall: a grid of self-playing games that each swap to a fresh random game on
// its own random 20–30s timer. Two tabs (two screens) coordinate over a
// BroadcastChannel so they never show the same game at the same time.

const MIN_S = 20, MAX_S = 30
const STALE_MS = 8000 // forget a tab we haven't heard from in this long

function parseN() {
  const h = window.location.hash
  const qi = h.indexOf('?')
  const n = qi >= 0 ? Number(new URLSearchParams(h.slice(qi + 1)).get('n')) : NaN
  return [4, 6, 9].includes(n) ? n : 6
}
const dur = () => MIN_S + Math.random() * (MAX_S - MIN_S)

export default function Wall() {
  const [n, setN] = useState(parseN)
  const [slots, setSlots] = useState([]) // [{ id, key, dur, startAt }]
  const slotsRef = useRef(slots)
  slotsRef.current = slots

  const tabId = useRef(Math.random().toString(36).slice(2))
  const others = useRef(new Map()) // tabId -> { ids:Set, seen:ms }
  const chan = useRef(null)
  const counter = useRef(0)

  // ids currently claimed by OTHER live tabs
  function otherIds() {
    const out = new Set()
    const now = Date.now()
    for (const [tid, info] of [...others.current]) {
      if (now - info.seen > STALE_MS) { others.current.delete(tid); continue }
      for (const id of info.ids) out.add(id)
    }
    return out
  }
  // pick a random game id not in `taken`
  function pick(taken) {
    let pool = games.filter((g) => !taken.has(g.id))
    if (!pool.length) pool = games // graceful fallback if everything is claimed
    return pool[(Math.random() * pool.length) | 0].id
  }
  function makeSlot(taken) {
    const id = pick(taken)
    taken.add(id)
    return { id, key: ++counter.current, dur: dur(), startAt: Date.now() }
  }
  function broadcast(arr) {
    try { chan.current?.postMessage({ tabId: tabId.current, ids: arr.map((s) => s.id) }) } catch { /* ignore */ }
  }

  useEffect(() => {
    let ch = null
    try { ch = new BroadcastChannel('10xwall'); chan.current = ch } catch { /* unsupported */ }
    if (ch) {
      ch.onmessage = (e) => {
        const m = e.data
        if (!m || m.tabId === tabId.current) return
        others.current.set(m.tabId, { ids: new Set(m.ids || []), seen: Date.now() })
        // Conflict resolution: the higher tabId yields overlapping games.
        if (tabId.current > m.tabId) {
          const otherSet = new Set(m.ids || [])
          const cur = slotsRef.current
          if (cur.some((s) => otherSet.has(s.id))) {
            const taken = new Set([...otherSet, ...cur.filter((s) => !otherSet.has(s.id)).map((s) => s.id)])
            const next = cur.map((s) => (otherSet.has(s.id) ? makeSlot(taken) : s))
            setSlots(next); broadcast(next)
          }
        }
      }
    }

    // Initial fill, slightly delayed + randomized so a second tab hears the first.
    const fillT = setTimeout(() => {
      const taken = otherIds()
      const arr = []
      for (let i = 0; i < n; i++) arr.push(makeSlot(taken))
      setSlots(arr); broadcast(arr)
    }, 180 + Math.random() * 320)

    // Swap due slots (each on its own deadline). One light interval drives all of them.
    const swapT = setInterval(() => {
      const now = Date.now()
      const cur = slotsRef.current
      if (!cur.length || !cur.some((s) => now - s.startAt >= s.dur * 1000)) return
      const taken = otherIds()
      for (const s of cur) if (now - s.startAt < s.dur * 1000) taken.add(s.id) // keep non-swapping ids
      const next = cur.map((s) => (now - s.startAt >= s.dur * 1000 ? makeSlot(taken) : s))
      setSlots(next); broadcast(next)
    }, 500)

    // Heartbeat so the other tab knows we're alive (+ prunes us if we close).
    const beatT = setInterval(() => broadcast(slotsRef.current), 2500)

    return () => {
      clearTimeout(fillT); clearInterval(swapT); clearInterval(beatT)
      if (ch) { ch.onmessage = null; ch.close() }
    }
  }, [n])

  const cols = n === 4 ? 2 : 3
  const rows = Math.ceil(n / cols)

  return (
    <div className="wall">
      <div className="wall-top">
        <a className="back-btn" href="#/">← All games</a>
        <span className="wall-title">Demo Wall</span>
        <span className="wall-sub">games self-play · reshuffle every 20–30s · open on each screen</span>
        <div className="wall-n">
          {[4, 6, 9].map((k) => (
            <a key={k} className={`wall-n-btn${n === k ? ' on' : ''}`} href={`#/wall?n=${k}`} onClick={() => setN(k)}>{k}</a>
          ))}
        </div>
        <span className="brand-mini">10x</span>
      </div>
      <div className="wall-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>
        {Array.from({ length: n }, (_, i) => {
          const slot = slots[i]
          const g = slot && getGame(slot.id)
          return (
            <div className="wall-cell" key={i}>
              {g && (
                <>
                  <div className="wall-cell-game"><g.component key={slot.key} accent={g.accent} /></div>
                  <div className="wall-cap"><span className="wall-cap-title">{g.title}</span><span className="wall-cap-cat">{g.category}</span></div>
                  <div className="wall-bar-track"><div className="wall-bar" key={slot.key} style={{ '--dur': `${slot.dur}s` }} /></div>
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
