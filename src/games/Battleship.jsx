import { useEffect, useRef } from 'react'
import { isAutoplay, shouldAutoWin, recordAutoplayResult } from '../autoplay.js'

// Battleship vs AI on canvas, 10x neon style.
// Two stacked 10x10 grids: enemy on top (you attack), your fleet below.
// AI fires with HUNT/TARGET logic. In autoplay the shown player fires with a
// probability/hunt-target strategy; win rate self-corrects to ~95% via autoplay.js.
const N = 10
const CELL = 38
const GAP = 4 // gap between grid lines
const PAD = 18
const HEADER = 46 // top status band
const LABEL = 22 // label band above each grid
const GRID_W = N * CELL
const GRID_H = N * CELL

const GRID_X = PAD
const ENEMY_Y = PAD + HEADER + LABEL
const MINE_Y = ENEMY_Y + GRID_H + LABEL + 30

const W = PAD * 2 + GRID_W // 416
const H = MINE_Y + GRID_H + 24 // 720-ish

const PINK = '#ff2d6f'
const CYAN = '#2de2e6'
const MUTED = '#8a93ad'
const BEST_KEY = '10xgames.battleship.best'

// Fleet: name -> length. Standard set.
const FLEET = [
  ['carrier', 5],
  ['battleship', 4],
  ['cruiser', 3],
  ['submarine', 3],
  ['destroyer', 2],
]

// ---------- pure helpers (cells are flat index r*N + c) ----------
const idx = (r, c) => r * N + c
const inB = (r, c) => r >= 0 && r < N && c >= 0 && c < N

// Place a fleet randomly with no overlap / in bounds. Returns
// { ships: [{cells:[i...], hits:Set, len, name}], occ: Int8Array(N*N) of shipIndex+1 or 0 }.
function placeFleet() {
  while (true) {
    const occ = new Int8Array(N * N) // 0 empty, else shipIndex+1
    const ships = []
    let ok = true
    for (let s = 0; s < FLEET.length; s++) {
      const [name, len] = FLEET[s]
      let placed = false
      for (let tries = 0; tries < 200 && !placed; tries++) {
        const horiz = Math.random() < 0.5
        const r = Math.floor(Math.random() * (horiz ? N : N - len + 1))
        const c = Math.floor(Math.random() * (horiz ? N - len + 1 : N))
        const cells = []
        let free = true
        for (let k = 0; k < len; k++) {
          const rr = horiz ? r : r + k
          const cc = horiz ? c + k : c
          if (!inB(rr, cc) || occ[idx(rr, cc)] !== 0) { free = false; break }
          cells.push(idx(rr, cc))
        }
        if (!free) continue
        for (const i of cells) occ[i] = s + 1
        ships.push({ name, len, cells, hits: new Set() })
        placed = true
      }
      if (!placed) { ok = false; break }
    }
    if (ok) return { ships, occ }
  }
}

// Find the ship occupying cell i, or null.
function shipAt(fleet, i) {
  const s = fleet.occ[i]
  return s ? fleet.ships[s - 1] : null
}

function shipsRemaining(fleet) {
  let n = 0
  for (const s of fleet.ships) if (s.hits.size < s.len) n++
  return n
}

const allSunk = (fleet) => fleet.ships.every((s) => s.hits.size >= s.len)

export default function Battleship() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')

    const auto = isAutoplay('battleship')

    // mover: 'player' fires at enemy grid; 'ai' fires at my grid
    let enemy, mine, shots, myShots, state, result, mover, lock
    let best = 0
    let raf = 0, aiTimer = 0, autoTimer = 0, restartTimer = 0
    let hover = -1 // hovered enemy cell index, -1 none
    let wantWin = true
    let flashT = 0 // animates sunk-ship flash

    // AI hunt/target memory (firing at MY grid)
    let aiQueue = [] // candidate target cells
    let aiHits = [] // current chain of hits forming a ship

    try { best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0 } catch { best = 0 }

    function reset() {
      enemy = placeFleet()
      mine = placeFleet()
      shots = new Int8Array(N * N) // player's shots on enemy: 0 none, 1 miss, 2 hit
      myShots = new Int8Array(N * N) // ai's shots on mine
      state = 'playing'; result = null; mover = 'player'; lock = false
      aiQueue = []; aiHits = []
      if (auto) wantWin = shouldAutoWin('battleship')
      if (auto) scheduleAuto()
    }

    // ---------- streak persistence (best win streak) ----------
    let streak = 0
    function recordWin(won) {
      if (won) {
        streak++
        if (streak > best) { best = streak; try { localStorage.setItem(BEST_KEY, String(best)) } catch { /* ignore */ } }
      } else {
        streak = 0
      }
    }

    // ---------- firing ----------
    // Player fires at enemy cell i. Returns true if a shot was actually taken.
    function playerFire(i) {
      if (state !== 'over' && mover === 'player' && shots[i] === 0) {
        const s = shipAt(enemy, i)
        if (s) { shots[i] = 2; s.hits.add(i); flashT = 0 }
        else { shots[i] = 1 }
        if (allSunk(enemy)) { finish('player'); return true }
        mover = 'ai'
        scheduleAI()
        return true
      }
      return false
    }

    // ---------- AI move selection (firing at MY grid) ----------
    // Neighbors of a cell, in-bounds and not yet fired upon.
    function freshNeighbors(i) {
      const r = (i / N) | 0, c = i % N
      const out = []
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const rr = r + dr, cc = c + dc
        if (inB(rr, cc) && myShots[idx(rr, cc)] === 0) out.push(idx(rr, cc))
      }
      return out
    }

    // Pick AI's next shot index on MY grid.
    function aiPick() {
      // In autoplay WIN rounds, weaken the AI to pure random (no targeting) so the
      // shown player sinks the fleet first ~95%. Otherwise full hunt/target.
      const weak = auto && wantWin
      if (!weak) {
        // TARGET phase: drain the queue of adjacent candidates.
        while (aiQueue.length) {
          const t = aiQueue.shift()
          if (myShots[t] === 0) return t
        }
      }
      // HUNT: pick a random un-fired cell. Use parity (checkerboard) to be efficient,
      // but only in strong mode; weak mode fires purely randomly across all cells.
      const cells = []
      for (let i = 0; i < N * N; i++) {
        if (myShots[i] !== 0) continue
        if (!weak) {
          const r = (i / N) | 0, c = i % N
          if (((r + c) & 1) !== 0) continue // checkerboard hunt
        }
        cells.push(i)
      }
      if (cells.length === 0) {
        // parity exhausted (strong mode) — fall back to any free cell
        for (let i = 0; i < N * N; i++) if (myShots[i] === 0) cells.push(i)
      }
      return cells[Math.floor(Math.random() * cells.length)]
    }

    // Update AI hunt/target memory after a hit on MY grid at cell i (ship s).
    function aiOnHit(i, s) {
      if (auto && wantWin) return // weak AI: no targeting
      const justSunk = s.hits.size >= s.len
      if (justSunk) { aiQueue = []; aiHits = []; return }
      aiHits.push(i)
      if (aiHits.length >= 2) {
        // Lock onto the ship's line: only queue cells extending the line.
        const a = aiHits[aiHits.length - 2], b = aiHits[aiHits.length - 1]
        const sameRow = ((a / N) | 0) === ((b / N) | 0)
        const ext = []
        for (const c of aiHits) {
          const r = (c / N) | 0, col = c % N
          if (sameRow) {
            if (inB(r, col + 1) && myShots[idx(r, col + 1)] === 0) ext.push(idx(r, col + 1))
            if (inB(r, col - 1) && myShots[idx(r, col - 1)] === 0) ext.push(idx(r, col - 1))
          } else {
            if (inB(r + 1, col) && myShots[idx(r + 1, col)] === 0) ext.push(idx(r + 1, col))
            if (inB(r - 1, col) && myShots[idx(r - 1, col)] === 0) ext.push(idx(r - 1, col))
          }
        }
        aiQueue = ext
      } else {
        // first hit of a new ship — probe all neighbors
        aiQueue = freshNeighbors(i)
      }
    }

    function scheduleAI() {
      lock = true
      clearTimeout(aiTimer)
      aiTimer = setTimeout(() => {
        if (state === 'over') { lock = false; return }
        const i = aiPick()
        const s = shipAt(mine, i)
        if (s) { myShots[i] = 2; s.hits.add(i); aiOnHit(i, s) }
        else { myShots[i] = 1 }
        if (allSunk(mine)) { finish('ai'); lock = false; return }
        mover = 'player'; lock = false
        if (auto && state === 'playing') scheduleAuto()
      }, 300 + Math.floor(Math.random() * 200))
    }

    function finish(winner) {
      state = 'over'
      result = winner
      flashT = 0
      const shownWon = winner === 'player'
      recordWin(shownWon)
      if (auto) {
        recordAutoplayResult('battleship', shownWon === true)
        clearTimeout(restartTimer)
        restartTimer = setTimeout(() => { clearTimeout(aiTimer); clearTimeout(autoTimer); lock = false; reset() }, 1800)
      }
    }

    // ---------- autoplay: drive the shown player firing at the enemy grid ----------
    // Shown player's hunt/target memory (firing at ENEMY grid)
    let pQueue = []
    let pHits = []

    function pFreshNeighbors(i) {
      const r = (i / N) | 0, c = i % N
      const out = []
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const rr = r + dr, cc = c + dc
        if (inB(rr, cc) && shots[idx(rr, cc)] === 0) out.push(idx(rr, cc))
      }
      return out
    }

    // Choose the shown player's shot on the ENEMY grid.
    // WIN rounds: strong probability/hunt-target. LOSE rounds: pure random.
    function autoPick() {
      if (!wantWin) {
        const free = []
        for (let i = 0; i < N * N; i++) if (shots[i] === 0) free.push(i)
        return free[Math.floor(Math.random() * free.length)]
      }
      while (pQueue.length) {
        const t = pQueue.shift()
        if (shots[t] === 0) return t
      }
      const cells = []
      for (let i = 0; i < N * N; i++) {
        if (shots[i] !== 0) continue
        const r = (i / N) | 0, c = i % N
        if (((r + c) & 1) !== 0) continue
        cells.push(i)
      }
      if (cells.length === 0) for (let i = 0; i < N * N; i++) if (shots[i] === 0) cells.push(i)
      return cells[Math.floor(Math.random() * cells.length)]
    }

    function autoOnHit(i, s) {
      if (!wantWin) return
      const justSunk = s.hits.size >= s.len
      if (justSunk) { pQueue = []; pHits = []; return }
      pHits.push(i)
      if (pHits.length >= 2) {
        const a = pHits[pHits.length - 2], b = pHits[pHits.length - 1]
        const sameRow = ((a / N) | 0) === ((b / N) | 0)
        const ext = []
        for (const cc2 of pHits) {
          const r = (cc2 / N) | 0, col = cc2 % N
          if (sameRow) {
            if (inB(r, col + 1) && shots[idx(r, col + 1)] === 0) ext.push(idx(r, col + 1))
            if (inB(r, col - 1) && shots[idx(r, col - 1)] === 0) ext.push(idx(r, col - 1))
          } else {
            if (inB(r + 1, col) && shots[idx(r + 1, col)] === 0) ext.push(idx(r + 1, col))
            if (inB(r - 1, col) && shots[idx(r - 1, col)] === 0) ext.push(idx(r - 1, col))
          }
        }
        pQueue = ext
      } else {
        pQueue = pFreshNeighbors(i)
      }
    }

    function scheduleAuto() {
      clearTimeout(autoTimer)
      if (!auto) return
      autoTimer = setTimeout(() => {
        if (state === 'over') return
        if (mover !== 'player' || lock) { scheduleAuto(); return }
        const i = autoPick()
        if (i === undefined) return
        const s = shipAt(enemy, i)
        if (s) { shots[i] = 2; s.hits.add(i); autoOnHit(i, s); flashT = 0 }
        else { shots[i] = 1 }
        if (allSunk(enemy)) { finish('player'); return }
        mover = 'ai'
        scheduleAI()
      }, 300 + Math.floor(Math.random() * 200))
    }

    // ---------- input ----------
    function enemyCellFromEvent(e) {
      const rect = canvas.getBoundingClientRect()
      const scale = W / rect.width
      const x = (e.clientX - rect.left) * scale - GRID_X
      const y = (e.clientY - rect.top) * scale - ENEMY_Y
      if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) return -1
      const c = Math.floor(x / CELL), r = Math.floor(y / CELL)
      if (!inB(r, c)) return -1
      return idx(r, c)
    }
    function onMove(e) { hover = auto ? -1 : enemyCellFromEvent(e) }
    function onLeave() { hover = -1 }
    function onPointer(e) {
      e.preventDefault()
      if (auto) return
      if (state === 'over') { reset(); return }
      const i = enemyCellFromEvent(e)
      if (i >= 0) playerFire(i)
    }
    function onKey(e) {
      if (e.code === 'KeyR') { e.preventDefault(); clearTimeout(aiTimer); clearTimeout(autoTimer); clearTimeout(restartTimer); lock = false; reset() }
      else if (e.code === 'Space') { e.preventDefault(); if (state === 'over' && !auto) reset() }
    }
    canvas.addEventListener('pointerdown', onPointer)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerleave', onLeave)
    window.addEventListener('keydown', onKey)

    // ---------- drawing ----------
    const cx = (c) => GRID_X + c * CELL + CELL / 2
    const cyE = (r) => ENEMY_Y + r * CELL + CELL / 2
    const cyM = (r) => MINE_Y + r * CELL + CELL / 2

    function sparkle(x, y, s) {
      ctx.strokeStyle = PINK; ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(x - s, y); ctx.lineTo(x + s, y); ctx.moveTo(x, y - s); ctx.lineTo(x, y + s); ctx.stroke()
    }

    function panel(y) {
      ctx.fillStyle = '#15151c'
      const pr = 12
      const bx = GRID_X - 5, by = y - 5, bw = GRID_W + 10, bh = GRID_H + 10
      ctx.beginPath()
      ctx.moveTo(bx + pr, by)
      ctx.arcTo(bx + bw, by, bx + bw, by + bh, pr)
      ctx.arcTo(bx + bw, by + bh, bx, by + bh, pr)
      ctx.arcTo(bx, by + bh, bx, by, pr)
      ctx.arcTo(bx, by, bx + bw, by, pr)
      ctx.closePath(); ctx.fill()
    }

    function gridLines(y) {
      ctx.strokeStyle = 'rgba(255,45,111,0.18)'; ctx.lineWidth = 1
      for (let i = 0; i <= N; i++) {
        const x = GRID_X + i * CELL
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + GRID_H); ctx.stroke()
        const yy = y + i * CELL
        ctx.beginPath(); ctx.moveTo(GRID_X, yy); ctx.lineTo(GRID_X + GRID_W, yy); ctx.stroke()
      }
    }

    function label(text, y, color) {
      ctx.textAlign = 'left'
      ctx.fillStyle = color; ctx.font = '800 14px system-ui, sans-serif'
      const t = text.toUpperCase()
      ctx.fillText(t, GRID_X, y)
      const tw = ctx.measureText(t).width
      ctx.fillStyle = PINK; ctx.fillRect(GRID_X, y + 5, tw, 3)
    }

    // a filled rounded-ish cell block (for ships / hits)
    function block(x, y, color, glow, inset) {
      const ins = inset || 5
      ctx.fillStyle = color
      if (glow) { ctx.shadowColor = color; ctx.shadowBlur = glow }
      ctx.fillRect(x + ins, y + ins, CELL - ins * 2, CELL - ins * 2)
      ctx.shadowBlur = 0
    }

    function hitMark(x, y, glow) {
      const ax = x + CELL / 2, ay = y + CELL / 2, s = CELL / 2 - 8
      ctx.strokeStyle = PINK; ctx.lineWidth = 3
      ctx.shadowColor = PINK; ctx.shadowBlur = glow || 12
      ctx.beginPath()
      ctx.moveTo(ax - s, ay - s); ctx.lineTo(ax + s, ay + s)
      ctx.moveTo(ax + s, ay - s); ctx.lineTo(ax - s, ay + s)
      ctx.stroke(); ctx.shadowBlur = 0
    }

    function missMark(x, y) {
      ctx.fillStyle = 'rgba(180,190,210,0.45)'
      ctx.beginPath(); ctx.arc(x + CELL / 2, y + CELL / 2, 4, 0, Math.PI * 2); ctx.fill()
    }

    function draw() {
      flashT += 1
      ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, W, H)
      sparkle(W - 16, 18, 5); sparkle(16, H - 18, 4)
      sparkle(W - 16, H - 18, 4)

      // ---- status header ----
      let status, color = '#fff'
      if (state === 'over') {
        status = result === 'player' ? 'YOU WIN' : 'CPU WINS'
        color = result === 'player' ? PINK : CYAN
      } else {
        status = mover === 'player' ? 'YOUR TURN — FIRE' : 'CPU FIRING…'
        color = mover === 'player' ? PINK : CYAN
      }
      ctx.textAlign = 'center'
      ctx.fillStyle = color; ctx.font = '800 24px system-ui, sans-serif'
      ctx.fillText(status, W / 2, PAD + 20)
      const tw = ctx.measureText(status).width
      ctx.fillStyle = PINK; ctx.fillRect(W / 2 - tw / 2, PAD + 28, tw, 3)
      ctx.font = '600 12px system-ui, sans-serif'
      ctx.fillStyle = MUTED
      ctx.fillText('BEST STREAK ' + best, W / 2, PAD + 44)

      // ---- enemy grid (top): you attack ----
      label('ENEMY WATERS · ' + shipsRemaining(enemy) + ' LEFT', ENEMY_Y - 8, CYAN)
      panel(ENEMY_Y)
      gridLines(ENEMY_Y)
      // hover highlight (human only)
      if (!auto && state === 'playing' && mover === 'player' && hover >= 0 && shots[hover] === 0) {
        const r = (hover / N) | 0, c = hover % N
        ctx.fillStyle = 'rgba(255,45,111,0.18)'
        ctx.fillRect(GRID_X + c * CELL + 1, ENEMY_Y + r * CELL + 1, CELL - 2, CELL - 2)
      }
      for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
          const i = idx(r, c)
          const x = GRID_X + c * CELL, y = ENEMY_Y + r * CELL
          if (shots[i] === 1) missMark(x, y)
          else if (shots[i] === 2) {
            const s = shipAt(enemy, i)
            const sunk = s && s.hits.size >= s.len
            if (sunk) {
              const fl = 0.55 + 0.45 * Math.abs(Math.sin(flashT * 0.12))
              block(x, y, PINK, 18 * fl, 4)
            }
            hitMark(x, y, sunk ? 18 : 12)
          }
        }
      }

      // ---- my grid (bottom): AI attacks ----
      label('YOUR FLEET · ' + shipsRemaining(mine) + ' LEFT', MINE_Y - 8, PINK)
      panel(MINE_Y)
      gridLines(MINE_Y)
      // draw my ships (cyan), then ai shots on top
      for (const s of mine.ships) {
        const sunk = s.hits.size >= s.len
        for (const i of s.cells) {
          const r = (i / N) | 0, c = i % N
          const x = GRID_X + c * CELL, y = MINE_Y + r * CELL
          if (sunk) {
            const fl = 0.55 + 0.45 * Math.abs(Math.sin(flashT * 0.12))
            block(x, y, PINK, 16 * fl, 5)
          } else {
            block(x, y, CYAN, 10, 5)
          }
        }
      }
      for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
          const i = idx(r, c)
          const x = GRID_X + c * CELL, y = MINE_Y + r * CELL
          if (myShots[i] === 1) missMark(x, y)
          else if (myShots[i] === 2) hitMark(x, y, 12)
        }
      }

      // ---- footer hint ----
      ctx.fillStyle = MUTED; ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'center'
      const hint = auto
        ? 'autoplay · R restart'
        : (state === 'over' ? 'tap / space to play again · R restart' : 'click enemy waters to fire · R restart')
      ctx.fillText(hint, W / 2, H - 8)
    }

    function loop() { draw(); raf = requestAnimationFrame(loop) }

    reset()
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(aiTimer)
      clearTimeout(autoTimer)
      clearTimeout(restartTimer)
      canvas.removeEventListener('pointerdown', onPointer)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  return (
    <canvas ref={canvasRef} width={W} height={H} className="battleship-canvas" aria-label="Battleship game" />
  )
}
