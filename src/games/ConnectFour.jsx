import { useEffect, useRef } from 'react'
import { isAutoplay, shouldAutoWin, recordAutoplayResult } from '../autoplay.js'

// Connect Four on canvas, 10x neon style, with a depth-limited alpha-beta minimax AI.
// Player = pink, goes first. AI = cyan. The AI never misses an immediate win or block.
const COLS = 7
const ROWS = 6
const CELL = 64
const PAD = 16
const HEADER = 56
const DROP_ZONE = 56 // space at top for the hovering ghost disc
const BOARD_W = COLS * CELL
const BOARD_H = ROWS * CELL
const BOARD_X = PAD
const BOARD_Y = PAD + HEADER + DROP_ZONE
const W = PAD * 2 + BOARD_W
const H = BOARD_Y + BOARD_H + PAD + 22 // room for hint line

const PINK = '#ff2d6f' // human
const CYAN = '#2de2e6' // AI
const P = 1 // player
const A = 2 // ai
const DEPTH = 5

// ---------- pure game logic (board is COLS*ROWS flat array, [c*ROWS + r], r=0 bottom) ----------
const idx = (c, r) => c * ROWS + r
const colHeight = (b, c) => { let h = 0; while (h < ROWS && b[idx(c, h)]) h++; return h }
const validCols = (b) => { const v = []; for (let c = 0; c < COLS; c++) if (b[idx(c, ROWS - 1)] === 0) v.push(c); return v }
const isFull = (b) => validCols(b).length === 0

// Returns winning piece (P/A) and the 4 cells, or null. Scans every line of 4.
function findWin(b) {
  const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]]
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      const p = b[idx(c, r)]
      if (!p) continue
      for (const [dc, dr] of dirs) {
        const cells = [[c, r]]
        let ok = true
        for (let k = 1; k < 4; k++) {
          const nc = c + dc * k, nr = r + dr * k
          if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS || b[idx(nc, nr)] !== p) { ok = false; break }
          cells.push([nc, nr])
        }
        if (ok) return { player: p, cells }
      }
    }
  }
  return null
}

// Drop a piece for `piece` into column c. Mutates and returns the row, or -1 if full.
function drop(b, c, piece) {
  const h = colHeight(b, c)
  if (h >= ROWS) return -1
  b[idx(c, h)] = piece
  return h
}

// Heuristic: score a window of 4 cells.
function scoreWindow(cells) {
  let ai = 0, pl = 0
  for (const v of cells) { if (v === A) ai++; else if (v === P) pl++ }
  if (ai && pl) return 0 // blocked window, no potential
  if (ai === 3) return 100
  if (ai === 2) return 10
  if (ai === 1) return 1
  if (pl === 3) return -120 // weight blocking slightly higher than building
  if (pl === 2) return -10
  if (pl === 1) return -1
  return 0
}

function evaluate(b) {
  let score = 0
  // center column preference
  for (let r = 0; r < ROWS; r++) { const v = b[idx(3, r)]; if (v === A) score += 6; else if (v === P) score -= 6 }
  const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]]
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      for (const [dc, dr] of dirs) {
        const ec = c + dc * 3, er = r + dr * 3
        if (ec < 0 || ec >= COLS || er < 0 || er >= ROWS) continue
        const cells = [
          b[idx(c, r)], b[idx(c + dc, r + dr)],
          b[idx(c + dc * 2, r + dr * 2)], b[idx(c + dc * 3, r + dr * 3)],
        ]
        score += scoreWindow(cells)
      }
    }
  }
  return score
}

// Move ordering: center-out, improves alpha-beta pruning.
const ORDER = [3, 2, 4, 1, 5, 0, 6]
const orderedCols = (b) => ORDER.filter((c) => b[idx(c, ROWS - 1)] === 0)

// Negamax-style minimax with alpha-beta. AI maximizes.
function minimax(b, depth, alpha, beta, maximizing) {
  const win = findWin(b)
  if (win) return win.player === A ? 1000000 + depth : -1000000 - depth
  if (depth === 0 || isFull(b)) return evaluate(b)

  const cols = orderedCols(b)
  if (maximizing) {
    let best = -Infinity
    for (const c of cols) {
      const h = colHeight(b, c)
      b[idx(c, h)] = A
      const s = minimax(b, depth - 1, alpha, beta, false)
      b[idx(c, h)] = 0
      if (s > best) best = s
      if (best > alpha) alpha = best
      if (alpha >= beta) break
    }
    return best
  } else {
    let best = Infinity
    for (const c of cols) {
      const h = colHeight(b, c)
      b[idx(c, h)] = P
      const s = minimax(b, depth - 1, alpha, beta, true)
      b[idx(c, h)] = 0
      if (s < best) best = s
      if (best < beta) beta = best
      if (alpha >= beta) break
    }
    return best
  }
}

function bestMove(b) {
  const cols = orderedCols(b)
  // 1) immediate win
  for (const c of cols) {
    const t = b.slice(); drop(t, c, A)
    if (findWin(t)) return c
  }
  // 2) immediate block of player's win
  for (const c of cols) {
    const t = b.slice(); drop(t, c, P)
    if (findWin(t)) return c
  }
  // 3) full search
  let bestScore = -Infinity, move = cols[0]
  for (const c of cols) {
    const h = colHeight(b, c)
    b[idx(c, h)] = A
    const s = minimax(b, DEPTH - 1, -Infinity, Infinity, false)
    b[idx(c, h)] = 0
    if (s > bestScore) { bestScore = s; move = c }
  }
  return move
}

// Best move for the PINK side, reusing minimax/evaluate (which score from A's view, so pink minimizes).
function bestMoveForPink(b) {
  const cols = orderedCols(b)
  // 1) immediate win for pink
  for (const c of cols) {
    const t = b.slice(); drop(t, c, P)
    if (findWin(t)) return c
  }
  // 2) immediate block of AI's win
  for (const c of cols) {
    const t = b.slice(); drop(t, c, A)
    if (findWin(t)) return c
  }
  // 3) full search: pink wants the LOWEST score (eval favors A as positive)
  let bestScore = Infinity, move = cols[0]
  for (const c of cols) {
    const h = colHeight(b, c)
    b[idx(c, h)] = P
    const s = minimax(b, DEPTH - 1, -Infinity, Infinity, true)
    b[idx(c, h)] = 0
    if (s < bestScore) { bestScore = s; move = c }
  }
  return move
}

export default function ConnectFour() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const auto = isAutoplay('connect-four')

    let board, turn, state, result, winCells, aiOn, lock
    let hoverCol = -1
    let anim = null // { col, targetRow, piece, y, vy }
    let tally = { p: 0, a: 0, d: 0 }
    let aiTimer = 0, raf = 0
    // Autoplay self-play state.
    let wantWin = true // this round pink should win (true) or lose (false)
    let recorded = false // guard: record each finished session exactly once
    let autoMoveTimer = 0, autoRestartTimer = 0

    function reset() {
      board = new Array(COLS * ROWS).fill(0)
      turn = P; state = 'playing'; result = null; winCells = null; lock = false; anim = null
      if (aiOn === undefined) aiOn = true
      if (auto) {
        aiOn = true // CPU must stay enabled to play the cyan side
        wantWin = shouldAutoWin('connect-four') // self-corrects toward ~95% pink wins
        recorded = false
      }
    }

    const slotCX = (c) => BOARD_X + c * CELL + CELL / 2
    const slotCY = (r) => BOARD_Y + (ROWS - 1 - r) * CELL + CELL / 2

    function finish() {
      const w = findWin(board)
      if (w) {
        state = 'over'; result = w.player; winCells = w.cells
        tally[w.player === P ? 'p' : 'a']++
        recordSession(w.player === P)
        return true
      }
      if (isFull(board)) { state = 'over'; result = 'draw'; tally.d++; recordSession(false); return true }
      return false
    }

    // Record a finished autoplay session exactly once (pink win = true).
    function recordSession(pinkWon) {
      if (!auto || recorded) return
      recorded = true
      recordAutoplayResult('connect-four', pinkWon === true)
    }

    // Start dropping a disc: animate, then commit on landing.
    function startDrop(c, piece) {
      const targetRow = colHeight(board, c)
      if (targetRow >= ROWS) return false
      lock = true
      anim = { col: c, targetRow, piece, y: BOARD_Y - CELL / 2, vy: 0, targetY: slotCY(targetRow) }
      return true
    }

    function commitDrop() {
      const { col, piece } = anim
      drop(board, col, piece)
      anim = null
      lock = false
      if (finish()) return
      turn = turn === P ? A : P
      if (aiOn && turn === A) scheduleAI()
    }

    // Weakened CPU for autoplay WIN rounds: random valid column, only
    // blocking pink's immediate winning threat ~40% of the time. Never used
    // for human play — there scheduleAI always calls full-strength bestMove.
    function weakCpuMove() {
      const cols = validCols(board)
      if (Math.random() < 0.4) {
        for (const c of cols) {
          const t = board.slice(); drop(t, c, P)
          if (findWin(t)) return c // block an immediate pink win
        }
      }
      return cols[Math.floor(Math.random() * cols.length)]
    }

    function scheduleAI() {
      lock = true
      aiTimer = setTimeout(() => {
        // Only weaken the CPU in autoplay WIN rounds; humans always face full strength.
        const c = (auto && wantWin) ? weakCpuMove() : bestMove(board)
        startDrop(c, A)
      }, 320)
    }

    function tryPlayerMove(c) {
      if (state === 'over' || lock || anim) return
      if (aiOn && turn !== P) return
      if (c < 0 || c >= COLS) return
      if (colHeight(board, c) >= ROWS) return
      startDrop(c, turn)
    }

    // ---------- input ----------
    function colFromX(e) {
      const rect = canvas.getBoundingClientRect()
      const x = (e.clientX - rect.left) * (W / rect.width) - BOARD_X
      if (x < 0 || x >= BOARD_W) return -1
      return Math.floor(x / CELL)
    }
    function onMove(e) {
      hoverCol = colFromX(e)
    }
    function onLeave() { hoverCol = -1 }
    function onPointer(e) {
      e.preventDefault()
      if (state === 'over') { reset(); return }
      tryPlayerMove(colFromX(e))
    }
    function onKey(e) {
      if (e.code === 'KeyR') { e.preventDefault(); clearTimeout(aiTimer); reset() }
      else if (e.code === 'KeyA') { if (!e.repeat) { aiOn = !aiOn; clearTimeout(aiTimer); reset() } }
      else if (e.code === 'Space') { e.preventDefault(); if (state === 'over') reset() }
    }
    canvas.addEventListener('pointerdown', onPointer)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerleave', onLeave)
    window.addEventListener('keydown', onKey)

    // ---------- drawing ----------
    function sparkle(x, y, s) {
      ctx.strokeStyle = PINK; ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(x - s, y); ctx.lineTo(x + s, y); ctx.moveTo(x, y - s); ctx.lineTo(x, y + s); ctx.stroke()
    }
    function disc(cx, cy, color, glow) {
      ctx.beginPath(); ctx.arc(cx, cy, CELL / 2 - 7, 0, Math.PI * 2)
      ctx.fillStyle = color
      if (glow) { ctx.shadowColor = color; ctx.shadowBlur = glow }
      ctx.fill(); ctx.shadowBlur = 0
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
      ctx.fillText(status, W / 2, PAD + 24)
      // underline bar accent
      const tw = ctx.measureText(status).width
      ctx.fillStyle = PINK; ctx.fillRect(W / 2 - tw / 2, PAD + 32, tw, 3)
      // tally
      ctx.font = '600 12px system-ui, sans-serif'; ctx.fillStyle = '#8a93ad'
      const t = aiOn ? `YOU ${tally.p}   ·   CPU ${tally.a}   ·   DRAW ${tally.d}` : `PINK ${tally.p}   ·   CYAN ${tally.a}   ·   DRAW ${tally.d}`
      ctx.fillText(t, W / 2, PAD + 50)

      // ghost / hover disc
      if (state === 'playing' && !lock && !anim && hoverCol >= 0 && hoverCol < COLS && colHeight(board, hoverCol) < ROWS) {
        if (!aiOn || turn === P) {
          const gc = turn === P ? PINK : CYAN
          ctx.globalAlpha = 0.4
          disc(slotCX(hoverCol), BOARD_Y - DROP_ZONE / 2, gc, 10)
          ctx.globalAlpha = 1
        }
      }

      // board panel
      ctx.fillStyle = '#15151c'
      const pr = 14
      const bx = BOARD_X - 6, by = BOARD_Y - 6, bw = BOARD_W + 12, bh = BOARD_H + 12
      ctx.beginPath()
      ctx.moveTo(bx + pr, by)
      ctx.arcTo(bx + bw, by, bx + bw, by + bh, pr)
      ctx.arcTo(bx + bw, by + bh, bx, by + bh, pr)
      ctx.arcTo(bx, by + bh, bx, by, pr)
      ctx.arcTo(bx, by, bx + bw, by, pr)
      ctx.closePath(); ctx.fill()

      // holes + placed discs (skip the animating slot until it lands)
      for (let c = 0; c < COLS; c++) {
        for (let r = 0; r < ROWS; r++) {
          const cx = slotCX(c), cy = slotCY(r)
          const v = board[idx(c, r)]
          if (v) {
            disc(cx, cy, v === P ? PINK : CYAN, 14)
          } else {
            ctx.beginPath(); ctx.arc(cx, cy, CELL / 2 - 7, 0, Math.PI * 2)
            ctx.fillStyle = '#0a0a0a'; ctx.fill()
            ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1; ctx.stroke()
          }
        }
      }

      // animating falling disc
      if (anim) {
        disc(slotCX(anim.col), anim.y, anim.piece === P ? PINK : CYAN, 14)
      }

      // winning highlight glow ring
      if (winCells) {
        ctx.strokeStyle = result === P ? PINK : CYAN
        ctx.lineWidth = 4
        ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 22
        for (const [c, r] of winCells) {
          ctx.beginPath(); ctx.arc(slotCX(c), slotCY(r), CELL / 2 - 5, 0, Math.PI * 2); ctx.stroke()
        }
        ctx.shadowBlur = 0
      }

      // hint
      ctx.fillStyle = '#8a93ad'; ctx.font = '600 11px system-ui, sans-serif'
      const overHint = 'tap / space to play again'
      const playHint = 'click a column · R restart · A: ' + (aiOn ? 'switch to 2-player' : 'vs CPU')
      ctx.fillText(state === 'over' ? overHint : playHint, W / 2, H - 8)
    }

    // ---------- autoplay self-play (drives the pink side; CPU plays cyan) ----------
    function autoPinkMove() {
      if (!auto || state !== 'playing' || lock || anim || turn !== P) return
      const cols = validCols(board)
      if (!cols.length) return
      let c
      if (wantWin) c = bestMoveForPink(board) // strong minimax + weakened CPU → pink wins
      else c = cols[Math.floor(Math.random() * cols.length)] // random vs strong CPU → pink loses
      startDrop(c, P) // uses the game's own drop pipeline (not synthetic clicks)
    }

    function autoTick() {
      if (!auto) return
      if (state === 'over') {
        if (!autoRestartTimer) autoRestartTimer = setTimeout(() => { autoRestartTimer = 0; reset() }, 1500)
        return
      }
      // Only schedule a pink move when it's pink's turn and nothing is in flight.
      if (turn === P && !lock && !anim && !autoMoveTimer) {
        autoMoveTimer = setTimeout(() => { autoMoveTimer = 0; autoPinkMove() }, 500 + Math.random() * 200)
      }
    }

    function update() {
      if (anim) {
        anim.vy += 1.6 // gravity
        anim.y += anim.vy
        if (anim.y >= anim.targetY) { anim.y = anim.targetY; commitDrop() }
      }
      autoTick()
    }

    function loop() { update(); draw(); raf = requestAnimationFrame(loop) }

    reset()
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(aiTimer)
      clearTimeout(autoMoveTimer)
      clearTimeout(autoRestartTimer)
      canvas.removeEventListener('pointerdown', onPointer)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  return (
    <canvas ref={canvasRef} width={W} height={H} className="connect4-canvas" aria-label="Connect Four game" />
  )
}
