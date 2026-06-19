import { useEffect, useRef } from 'react'
import { isAutoplay, shouldAutoWin, recordAutoplayResult } from '../autoplay.js'

// Gomoku (Five in a Row) on canvas, 10x neon style, with a threat-search heuristic AI.
// Player = pink, goes first. AI = cyan. The AI never misses an immediate win or block.
const N = 15            // 15x15 grid of intersections
const CELL = 30         // px between lines
const MARGIN = 18       // panel padding around the playable grid
const HEADER = 56       // status header height
const GRID = (N - 1) * CELL                 // span from first to last line (420)
const BOARD = GRID + CELL                   // panel covers a half-cell border (450)
const BOARD_X = MARGIN
const BOARD_Y = MARGIN + HEADER
const GX = BOARD_X + CELL / 2               // x of column 0 line
const GY = BOARD_Y + CELL / 2               // y of row 0 line
const W = MARGIN * 2 + BOARD                // 486
const H = BOARD_Y + BOARD + MARGIN + 16     // room for hint line (~538)

const PINK = '#ff2d6f' // human / shown side
const CYAN = '#2de2e6' // AI
const P = 1
const A = 2
const BEST_KEY = '10xgames.gomoku.best'

// ---------- pure game logic (board is N*N flat array, [r*N + c]) ----------
const idx = (r, c) => r * N + c
const inB = (r, c) => r >= 0 && r < N && c >= 0 && c < N
const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]]

// Return { player, cells:[[r,c]x5] } for the FIRST 5-in-a-row found, or null.
function findWin(b) {
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const p = b[idx(r, c)]
      if (!p) continue
      for (const [dr, dc] of DIRS) {
        const cells = [[r, c]]
        let ok = true
        for (let k = 1; k < 5; k++) {
          const nr = r + dr * k, nc = c + dc * k
          if (!inB(nr, nc) || b[idx(nr, nc)] !== p) { ok = false; break }
          cells.push([nr, nc])
        }
        if (ok) return { player: p, cells }
      }
    }
  }
  return null
}

// True if placing `who` at (r,c) completes a 5-in-a-row.
function makesFive(b, r, c, who) {
  for (const [dr, dc] of DIRS) {
    let count = 1
    for (let s = 1; s < 5; s++) { const nr = r + dr * s, nc = c + dc * s; if (inB(nr, nc) && b[idx(nr, nc)] === who) count++; else break }
    for (let s = 1; s < 5; s++) { const nr = r - dr * s, nc = c - dc * s; if (inB(nr, nc) && b[idx(nr, nc)] === who) count++; else break }
    if (count >= 5) return true
  }
  return false
}

// Candidate empty cells: only those near existing stones (keeps the search small & sensible).
function candidates(b) {
  const out = []
  const seen = new Set()
  let any = false
  for (let i = 0; i < b.length; i++) if (b[i]) { any = true; break }
  if (!any) return [[7, 7]] // empty board → center
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (b[idx(r, c)]) continue
      let near = false
      for (let dr = -2; dr <= 2 && !near; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const nr = r + dr, nc = c + dc
          if (inB(nr, nc) && b[idx(nr, nc)]) { near = true; break }
        }
      }
      if (near) { const k = idx(r, c); if (!seen.has(k)) { seen.add(k); out.push([r, c]) } }
    }
  }
  return out
}

// Score a single line run for `who` through (r,c) assuming a stone is placed there:
// length of the contiguous run plus how open the ends are. Returns a pattern value.
function lineValue(b, r, c, who, dr, dc) {
  let count = 1
  let fwdOpen = false, backOpen = false
  let rr = r + dr, cc = c + dc
  while (inB(rr, cc) && b[idx(rr, cc)] === who) { count++; rr += dr; cc += dc }
  if (inB(rr, cc) && b[idx(rr, cc)] === 0) fwdOpen = true
  rr = r - dr; cc = c - dc
  while (inB(rr, cc) && b[idx(rr, cc)] === who) { count++; rr -= dr; cc -= dc }
  if (inB(rr, cc) && b[idx(rr, cc)] === 0) backOpen = true

  const ends = (fwdOpen ? 1 : 0) + (backOpen ? 1 : 0)
  if (count >= 5) return 1000000
  if (count === 4) return ends === 2 ? 100000 : (ends === 1 ? 12000 : 0)
  if (count === 3) return ends === 2 ? 8000 : (ends === 1 ? 800 : 0)
  if (count === 2) return ends === 2 ? 600 : (ends === 1 ? 80 : 0)
  if (count === 1) return ends === 2 ? 30 : (ends === 1 ? 8 : 0)
  return 0
}

// Value of placing `who` at (r,c): sum over the 4 directions of that move's own threats.
function placeValue(b, r, c, who) {
  let v = 0
  for (const [dr, dc] of DIRS) v += lineValue(b, r, c, who, dr, dc)
  return v
}

// Heuristic move for `me` (opponent = `foe`): always win, always block, else maximise
// own threat with a defensive bonus for smothering the opponent.
function bestMove(b, me, foe) {
  const cells = candidates(b)
  // 1) immediate win
  for (const [r, c] of cells) if (makesFive(b, r, c, me)) return [r, c]
  // 2) block opponent's immediate win
  for (const [r, c] of cells) if (makesFive(b, r, c, foe)) return [r, c]
  // 3) best combined attack/defence score
  let best = -Infinity, move = cells[0]
  for (const [r, c] of cells) {
    const atk = placeValue(b, r, c, me)
    const def = placeValue(b, r, c, foe) // value the opponent would gain here → worth denying
    const score = atk + def * 0.9 + center(r, c)
    if (score > best) { best = score; move = [r, c] }
  }
  return move
}

// Tiny center bias to keep play coherent in the opening.
const center = (r, c) => (14 - Math.abs(r - 7) - Math.abs(c - 7))

export default function Gomoku() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const auto = isAutoplay('gomoku')

    let board, turn, state, result, winCells, aiOn, lock, last
    let streak = 0
    let best = 0
    try { best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0 } catch { /* ignore */ }
    let tally = { p: 0, a: 0 }
    let aiTimer = 0, raf = 0
    // Autoplay self-play state.
    let wantWin = true
    let recorded = false
    let autoMoveTimer = 0, autoRestartTimer = 0

    function reset() {
      board = new Array(N * N).fill(0)
      turn = P; state = 'playing'; result = null; winCells = null; lock = false; last = null
      if (aiOn === undefined) aiOn = true
      if (auto) {
        aiOn = true
        wantWin = shouldAutoWin('gomoku')
        recorded = false
      }
      if (aiOn && turn === A) scheduleAI()
    }

    const lineX = (c) => GX + c * CELL
    const lineY = (r) => GY + r * CELL

    function recordSession(pinkWon) {
      if (!auto || recorded) return
      recorded = true
      recordAutoplayResult('gomoku', pinkWon === true)
    }

    function finish() {
      const w = findWin(board)
      if (w) {
        state = 'over'; result = w.player; winCells = w.cells
        tally[w.player === P ? 'p' : 'a']++
        if (w.player === P) {
          streak++
          if (streak > best) { best = streak; try { localStorage.setItem(BEST_KEY, String(best)) } catch { /* ignore */ } }
        } else streak = 0
        recordSession(w.player === P)
        return true
      }
      // board full → draw
      if (!board.includes(0)) {
        state = 'over'; result = 'draw'; streak = 0
        recordSession(false)
        return true
      }
      return false
    }

    function place(r, c, who) {
      board[idx(r, c)] = who
      last = [r, c]
      if (finish()) return
      turn = turn === P ? A : P
      if (aiOn && turn === A) scheduleAI()
    }

    // Weakened CPU for autoplay WIN rounds: a near-random nearby move that only
    // blocks the opponent's immediate 5-threat. Never used in human play.
    function weakMove() {
      const cells = candidates(board)
      for (const [r, c] of cells) if (makesFive(board, r, c, P)) return [r, c] // block 5-threat only
      return cells[Math.floor(Math.random() * cells.length)]
    }

    function scheduleAI() {
      lock = true
      clearTimeout(aiTimer)
      aiTimer = setTimeout(() => {
        if (state !== 'playing' || turn !== A) { lock = false; return }
        const mv = (auto && wantWin) ? weakMove() : bestMove(board, A, P)
        lock = false
        place(mv[0], mv[1], A)
      }, 350 + Math.random() * 200)
    }

    function tryPlayerMove(r, c) {
      if (state === 'over' || lock) return
      if (aiOn && turn !== P) return
      if (!inB(r, c) || board[idx(r, c)]) return
      place(r, c, turn)
    }

    // ---------- input ----------
    function cellFromEvent(e) {
      const rect = canvas.getBoundingClientRect()
      const x = (e.clientX - rect.left) * (W / rect.width)
      const y = (e.clientY - rect.top) * (H / rect.height)
      const c = Math.round((x - GX) / CELL)
      const r = Math.round((y - GY) / CELL)
      return [r, c]
    }
    function onPointer(e) {
      e.preventDefault()
      if (auto) return
      if (state === 'over') { reset(); return }
      const [r, c] = cellFromEvent(e)
      tryPlayerMove(r, c)
    }
    function onKey(e) {
      if (auto) return
      if (e.code === 'KeyR') { e.preventDefault(); clearTimeout(aiTimer); lock = false; reset() }
      else if (e.code === 'KeyA') { if (!e.repeat) { aiOn = !aiOn; clearTimeout(aiTimer); lock = false; reset() } }
      else if (e.code === 'Space') { e.preventDefault(); if (state === 'over') reset() }
    }
    canvas.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)

    // ---------- drawing ----------
    function sparkle(x, y, s) {
      ctx.strokeStyle = PINK; ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(x - s, y); ctx.lineTo(x + s, y); ctx.moveTo(x, y - s); ctx.lineTo(x, y + s); ctx.stroke()
    }
    function stone(cx, cy, color, glow) {
      const rad = CELL / 2 - 3
      ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.shadowColor = color; ctx.shadowBlur = glow
      ctx.fill(); ctx.shadowBlur = 0
      // glossy highlight
      const g = ctx.createRadialGradient(cx - rad * 0.35, cy - rad * 0.35, rad * 0.1, cx, cy, rad)
      g.addColorStop(0, 'rgba(255,255,255,0.55)')
      g.addColorStop(0.35, 'rgba(255,255,255,0.08)')
      g.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill()
    }

    function draw() {
      ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, W, H)
      sparkle(W - 18, 20, 5); sparkle(18, H - 20, 4)

      // status
      let status, color = '#fff'
      if (state === 'over') {
        if (result === 'draw') { status = 'DRAW'; color = '#8a93ad' }
        else if (aiOn) { status = result === P ? 'YOU WIN' : 'CPU WINS'; color = result === P ? PINK : CYAN }
        else { status = (result === P ? 'PINK' : 'CYAN') + ' WINS'; color = result === P ? PINK : CYAN }
      } else if (aiOn) { status = turn === P ? 'YOUR TURN' : 'CPU THINKING…'; color = turn === P ? PINK : CYAN }
      else { status = (turn === P ? 'PINK' : 'CYAN') + ' TURN'; color = turn === P ? PINK : CYAN }
      ctx.textAlign = 'center'
      ctx.fillStyle = color; ctx.font = '800 26px system-ui, sans-serif'
      ctx.fillText(status, W / 2, MARGIN + 24)
      const tw = ctx.measureText(status).width
      ctx.fillStyle = PINK; ctx.fillRect(W / 2 - tw / 2, MARGIN + 32, tw, 3)
      // tally + best streak
      ctx.font = '600 12px system-ui, sans-serif'; ctx.fillStyle = '#8a93ad'
      const t = aiOn
        ? `YOU ${tally.p}  ·  CPU ${tally.a}  ·  STREAK ${streak}  ·  BEST ${best}`
        : `PINK ${tally.p}  ·  CYAN ${tally.a}`
      ctx.fillText(t, W / 2, MARGIN + 50)

      // board panel (dark wood-ish)
      ctx.fillStyle = '#15151c'
      const pr = 14
      const bx = BOARD_X, by = BOARD_Y, bw = BOARD, bh = BOARD
      ctx.beginPath()
      ctx.moveTo(bx + pr, by)
      ctx.arcTo(bx + bw, by, bx + bw, by + bh, pr)
      ctx.arcTo(bx + bw, by + bh, bx, by + bh, pr)
      ctx.arcTo(bx, by + bh, bx, by, pr)
      ctx.arcTo(bx, by, bx + bw, by, pr)
      ctx.closePath(); ctx.fill()

      // subtle pink grid lines
      ctx.strokeStyle = 'rgba(255,45,111,0.22)'; ctx.lineWidth = 1
      ctx.beginPath()
      for (let i = 0; i < N; i++) {
        ctx.moveTo(lineX(i), GY); ctx.lineTo(lineX(i), GY + GRID)
        ctx.moveTo(GX, lineY(i)); ctx.lineTo(GX + GRID, lineY(i))
      }
      ctx.stroke()
      // star points (hoshi)
      ctx.fillStyle = 'rgba(255,45,111,0.5)'
      for (const [r, c] of [[3, 3], [3, 11], [11, 3], [11, 11], [7, 7]]) {
        ctx.beginPath(); ctx.arc(lineX(c), lineY(r), 3, 0, Math.PI * 2); ctx.fill()
      }

      // stones
      for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
          const v = board[idx(r, c)]
          if (v) stone(lineX(c), lineY(r), v === P ? PINK : CYAN, 14)
        }
      }

      // last move marker
      if (last && (!winCells)) {
        const [r, c] = last
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2
        ctx.shadowColor = '#fff'; ctx.shadowBlur = 8
        ctx.beginPath(); ctx.arc(lineX(c), lineY(r), CELL / 2 - 6, 0, Math.PI * 2); ctx.stroke()
        ctx.shadowBlur = 0
      }

      // winning line highlight
      if (winCells) {
        const wc = result === P ? PINK : CYAN
        ctx.strokeStyle = wc; ctx.lineWidth = 5
        ctx.shadowColor = wc; ctx.shadowBlur = 24
        const [r0, c0] = winCells[0], [r1, c1] = winCells[4]
        ctx.beginPath(); ctx.moveTo(lineX(c0), lineY(r0)); ctx.lineTo(lineX(c1), lineY(r1)); ctx.stroke()
        for (const [r, c] of winCells) {
          ctx.beginPath(); ctx.arc(lineX(c), lineY(r), CELL / 2 - 3, 0, Math.PI * 2); ctx.stroke()
        }
        ctx.shadowBlur = 0
      }

      // hint
      ctx.fillStyle = '#8a93ad'; ctx.font = '600 11px system-ui, sans-serif'
      const overHint = 'tap / space to play again'
      const playHint = 'click a point · R restart · A: ' + (aiOn ? 'switch to 2-player' : 'vs CPU')
      ctx.fillText(auto ? 'autoplay' : (state === 'over' ? overHint : playHint), W / 2, H - 7)
    }

    // ---------- autoplay self-play (drives BOTH sides) ----------
    function autoPinkMove() {
      if (!auto || state !== 'playing' || lock || turn !== P) return
      let mv
      if (wantWin) mv = bestMove(board, P, A) // strong pink vs weakened cyan
      else {
        const cells = candidates(board)
        // weak pink: only block an immediate cyan 5, else random → cyan (strong) wins
        mv = null
        for (const [r, c] of cells) if (makesFive(board, r, c, A)) { mv = [r, c]; break }
        if (!mv) mv = cells[Math.floor(Math.random() * cells.length)]
      }
      place(mv[0], mv[1], P)
    }

    function autoTick() {
      if (!auto) return
      if (state === 'over') {
        if (!autoRestartTimer) autoRestartTimer = setTimeout(() => { autoRestartTimer = 0; reset() }, 1500)
        return
      }
      if (turn === P && !lock && !autoMoveTimer) {
        autoMoveTimer = setTimeout(() => { autoMoveTimer = 0; autoPinkMove() }, 350 + Math.random() * 200)
      }
    }

    function loop() { autoTick(); draw(); raf = requestAnimationFrame(loop) }

    reset()
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(aiTimer)
      clearTimeout(autoMoveTimer)
      clearTimeout(autoRestartTimer)
      canvas.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  return (
    <canvas ref={canvasRef} width={W} height={H} className="gomoku-canvas" aria-label="Gomoku game" />
  )
}
