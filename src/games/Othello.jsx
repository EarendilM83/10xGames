import { useEffect, useRef } from 'react'
import { isAutoplay, shouldAutoWin, recordAutoplayResult } from '../autoplay.js'

// Othello / Reversi on canvas, 10x neon style, with a depth-limited alpha-beta minimax AI.
// Player = pink, moves first. AI = cyan. The AI grabs corners and avoids giving them away.
const N = 8
const CELL = 56
const PAD = 16
const HEADER = 56
const BOARD_W = N * CELL
const BOARD_H = N * CELL
const BOARD_X = PAD
const BOARD_Y = PAD + HEADER
const W = PAD * 2 + BOARD_W // 480
const H = BOARD_Y + BOARD_H + 22 // 540

const PINK = '#ff2d6f' // human
const CYAN = '#2de2e6' // AI
const P = 1 // player (moves first)
const A = 2 // ai
const DEPTH = 4
const BEST_KEY = '10xgames.othello.best'

const DIRS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
]

// ---------- pure game logic (board is flat N*N array, idx = r*N + c) ----------
const idx = (r, c) => r * N + c
const opp = (p) => (p === P ? A : P)
const inBounds = (r, c) => r >= 0 && r < N && c >= 0 && c < N

function initialBoard() {
  const b = new Array(N * N).fill(0)
  b[idx(3, 3)] = A; b[idx(4, 4)] = A
  b[idx(3, 4)] = P; b[idx(4, 3)] = P
  return b
}

// All cells flipped if `player` plays at (r,c). Walks each direction, collecting a
// contiguous run of opponent discs, and only keeps it if capped by `player` (never
// across an empty gap or the board edge). Empty result means the move is illegal.
function flipsFor(b, r, c, player) {
  if (b[idx(r, c)] !== 0) return []
  const o = opp(player)
  const out = []
  for (const [dr, dc] of DIRS) {
    const run = []
    let nr = r + dr, nc = c + dc
    while (inBounds(nr, nc) && b[idx(nr, nc)] === o) {
      run.push([nr, nc]); nr += dr; nc += dc
    }
    // valid only if the run is non-empty AND terminated by our own disc
    if (run.length && inBounds(nr, nc) && b[idx(nr, nc)] === player) {
      for (const cell of run) out.push(cell)
    }
  }
  return out
}

const isLegal = (b, r, c, player) => flipsFor(b, r, c, player).length > 0

function legalMoves(b, player) {
  const moves = []
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (b[idx(r, c)] !== 0) continue
      if (isLegal(b, r, c, player)) moves.push([r, c])
    }
  }
  return moves
}

// Apply a move on a copy and return the new board. Assumes the move is legal.
function applyMove(b, r, c, player) {
  const nb = b.slice()
  const flips = flipsFor(b, r, c, player)
  nb[idx(r, c)] = player
  for (const [fr, fc] of flips) nb[idx(fr, fc)] = player
  return nb
}

function counts(b) {
  let p = 0, a = 0
  for (let i = 0; i < b.length; i++) { if (b[i] === P) p++; else if (b[i] === A) a++ }
  return { p, a }
}

// ---------- AI evaluation ----------
// Positional weights: corners hugely positive, squares adjacent to empty corners
// (X- and C-squares) strongly negative. From AI's perspective.
const WEIGHTS = [
  120, -20, 20, 5, 5, 20, -20, 120,
  -20, -40, -5, -5, -5, -5, -40, -20,
  20, -5, 15, 3, 3, 15, -5, 20,
  5, -5, 3, 3, 3, 3, -5, 5,
  5, -5, 3, 3, 3, 3, -5, 5,
  20, -5, 15, 3, 3, 15, -5, 20,
  -20, -40, -5, -5, -5, -5, -40, -20,
  120, -20, 20, 5, 5, 20, -20, 120,
]

const CORNERS = [idx(0, 0), idx(0, 7), idx(7, 0), idx(7, 7)]

// Evaluate from AI's perspective (positive = good for AI).
function evaluate(b) {
  let pos = 0
  for (let i = 0; i < b.length; i++) {
    if (b[i] === A) pos += WEIGHTS[i]
    else if (b[i] === P) pos -= WEIGHTS[i]
  }
  // disc difference (small weight)
  const { p, a } = counts(b)
  const discDiff = a - p
  // mobility difference
  const aMob = legalMoves(b, A).length
  const pMob = legalMoves(b, P).length
  const mobility = aMob - pMob
  // heavy explicit corner bonus on top of positional weights
  let cornerBonus = 0
  for (const ci of CORNERS) { if (b[ci] === A) cornerBonus += 25; else if (b[ci] === P) cornerBonus -= 25 }
  return pos + discDiff + 8 * mobility + 30 * cornerBonus
}

// Minimax with alpha-beta. AI (A) maximizes, player (P) minimizes.
// `player` is whose turn it is at this node. Handles passes (no legal moves).
function minimax(b, depth, alpha, beta, player, passed) {
  if (depth === 0) return evaluate(b)
  const moves = legalMoves(b, player)
  if (moves.length === 0) {
    if (passed) return evaluate(b) // both passed -> terminal
    // current player passes, opponent moves (depth unchanged so we don't lose search depth on pass)
    return minimax(b, depth, alpha, beta, opp(player), true)
  }
  if (player === A) {
    let best = -Infinity
    for (const [r, c] of moves) {
      const nb = applyMove(b, r, c, A)
      const s = minimax(nb, depth - 1, alpha, beta, P, false)
      if (s > best) best = s
      if (best > alpha) alpha = best
      if (alpha >= beta) break
    }
    return best
  } else {
    let best = Infinity
    for (const [r, c] of moves) {
      const nb = applyMove(b, r, c, P)
      const s = minimax(nb, depth - 1, alpha, beta, A, false)
      if (s < best) best = s
      if (best < beta) beta = best
      if (alpha >= beta) break
    }
    return best
  }
}

// Pick the AI's best move. Returns [r,c] or null if no legal move.
function bestMove(b) {
  const moves = legalMoves(b, A)
  if (moves.length === 0) return null
  // order corners first to improve pruning
  moves.sort((m1, m2) => WEIGHTS[idx(m2[0], m2[1])] - WEIGHTS[idx(m1[0], m1[1])])
  let bestScore = -Infinity, move = moves[0]
  for (const [r, c] of moves) {
    const nb = applyMove(b, r, c, A)
    const s = minimax(nb, DEPTH - 1, -Infinity, Infinity, P, false)
    if (s > bestScore) { bestScore = s; move = [r, c] }
  }
  return move
}

export default function Othello() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')

    const auto = isAutoplay('othello')

    let board, turn, state, result, aiOn, lock
    let hover = -1 // flat index hovered, -1 none
    let lastMove = null // [r,c] of most recent placement
    let best = 0
    let aiTimer = 0, raf = 0
    let autoTimer = 0, restartTimer = 0
    let wantWin = true // this round, pink should win (true) or throw it (false)

    try { best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0 } catch { best = 0 }

    function reset() {
      board = initialBoard()
      turn = P; state = 'playing'; result = null; lock = false; lastMove = null
      if (aiOn === undefined) aiOn = true
      if (auto) {
        aiOn = true // AI must drive cyan
        wantWin = shouldAutoWin('othello') // self-corrects to ~95% pink wins
      }
      // P always has a legal opening move, but advance state machine for safety
      advanceIfStuck()
      if (auto && state !== 'over') {
        if (turn === A) scheduleAI() // pink passed at open (rare); let cyan go
        else scheduleAuto()
      }
    }

    // Choose pink's move for the current round. WIN rounds play STRONG: prefer
    // corners, then edges, then the eval/most-flips heuristic. LOSE rounds (~5%)
    // pick a random legal move so pink throws the game.
    function pickAutoMove() {
      const moves = legalMoves(board, P)
      if (moves.length === 0) return null
      if (!wantWin) return moves[Math.floor(Math.random() * moves.length)]
      // win: corners first
      const corners = moves.filter(([r, c]) => CORNERS.includes(idx(r, c)))
      if (corners.length) return corners[0]
      // then edges
      const edges = moves.filter(([r, c]) => r === 0 || r === N - 1 || c === 0 || c === N - 1)
      const pool = edges.length ? edges : moves
      // among pool, prefer best positional weight, tie-break by most flips
      let best = pool[0], bestScore = -Infinity
      for (const [r, c] of pool) {
        const score = WEIGHTS[idx(r, c)] * 100 + flipsFor(board, r, c, P).length
        if (score > bestScore) { bestScore = score; best = [r, c] }
      }
      return best
    }

    // Drive pink (the human side) on a timer using the game's own commit().
    function scheduleAuto() {
      clearTimeout(autoTimer)
      if (!auto) return
      autoTimer = setTimeout(() => {
        if (state === 'over') return
        // Only act on pink's turn; cyan is handled by scheduleAI(). If it's
        // cyan's turn (AI thinking), wait and re-check.
        if (turn !== P || lock) { scheduleAuto(); return }
        const m = pickAutoMove()
        if (m) commit(m[0], m[1], P) // game handles passes/turn advance
        else { advanceIfStuck() }
        if (state !== 'over' && turn === P) scheduleAuto()
      }, 500 + Math.floor(Math.random() * 200)) // ~500-700ms
    }

    // If the side to move has no legal move, pass; if neither can move, end the game.
    function advanceIfStuck() {
      if (legalMoves(board, turn).length > 0) return
      const other = opp(turn)
      if (legalMoves(board, other).length > 0) {
        turn = other // pass
      } else {
        finish()
      }
    }

    function finish() {
      state = 'over'
      const { p, a } = counts(board)
      if (p > a) result = P
      else if (a > p) result = A
      else result = 'draw'
      // best = largest player disc-margin win
      if (result === P) {
        const margin = p - a
        if (margin > best) { best = margin; try { localStorage.setItem(BEST_KEY, String(best)) } catch { /* ignore */ } }
      }
      if (auto) {
        const pinkWon = p > a // pink has more discs = win
        recordAutoplayResult('othello', pinkWon === true)
        clearTimeout(restartTimer)
        restartTimer = setTimeout(() => { clearTimeout(aiTimer); lock = false; reset() }, 1600) // loop forever
      }
    }

    // Commit a move for `player` at (r,c), then advance turn handling passes.
    function commit(r, c, player) {
      board = applyMove(board, r, c, player)
      lastMove = [r, c]
      turn = opp(player)
      // handle passes / game end for the new side to move
      advanceIfStuck()
      if (state === 'over') return
      if (aiOn && turn === A) scheduleAI()
      else if (auto && turn === P) scheduleAuto()
    }

    // Cyan's move. Normally the full minimax (strong). But in autoplay WIN rounds
    // we weaken cyan so pink reliably wins: cyan plays greedy most-flips, which is
    // actually a weak strategy in Othello (grabs discs early, gives up corners).
    function cyanMove() {
      if (auto && wantWin) {
        const moves = legalMoves(board, A)
        if (moves.length === 0) return null
        let pick = moves[0], bestFlips = -1
        for (const [r, c] of moves) {
          const f = flipsFor(board, r, c, A).length
          if (f > bestFlips) { bestFlips = f; pick = [r, c] }
        }
        return pick
      }
      return bestMove(board)
    }

    function scheduleAI() {
      lock = true
      aiTimer = setTimeout(() => {
        const m = cyanMove()
        lock = false
        if (m) commit(m[0], m[1], A)
        else { advanceIfStuck(); if (state !== 'over' && aiOn && turn === A) scheduleAI() }
      }, 340)
    }

    function tryPlayerMove(r, c) {
      if (state === 'over' || lock) return
      if (aiOn && turn !== P) return
      if (!inBounds(r, c)) return
      if (!isLegal(board, r, c, turn)) return
      commit(r, c, turn)
    }

    // ---------- input ----------
    function cellFromEvent(e) {
      const rect = canvas.getBoundingClientRect()
      const scale = W / rect.width
      const x = (e.clientX - rect.left) * scale - BOARD_X
      const y = (e.clientY - rect.top) * scale - BOARD_Y
      if (x < 0 || x >= BOARD_W || y < 0 || y >= BOARD_H) return null
      return [Math.floor(y / CELL), Math.floor(x / CELL)]
    }
    function onMove(e) {
      const cell = cellFromEvent(e)
      hover = cell ? idx(cell[0], cell[1]) : -1
    }
    function onLeave() { hover = -1 }
    function onPointer(e) {
      e.preventDefault()
      if (state === 'over') { reset(); return }
      const cell = cellFromEvent(e)
      if (cell) tryPlayerMove(cell[0], cell[1])
    }
    function onKey(e) {
      if (e.code === 'KeyR') { e.preventDefault(); clearTimeout(aiTimer); lock = false; reset() }
      else if (e.code === 'KeyA') { if (!e.repeat) { aiOn = !aiOn; clearTimeout(aiTimer); lock = false; reset() } }
      else if (e.code === 'Space') { e.preventDefault(); if (state === 'over') reset() }
    }
    canvas.addEventListener('pointerdown', onPointer)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerleave', onLeave)
    window.addEventListener('keydown', onKey)

    // ---------- drawing ----------
    const cellCX = (c) => BOARD_X + c * CELL + CELL / 2
    const cellCY = (r) => BOARD_Y + r * CELL + CELL / 2

    function sparkle(x, y, s) {
      ctx.strokeStyle = PINK; ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(x - s, y); ctx.lineTo(x + s, y); ctx.moveTo(x, y - s); ctx.lineTo(x, y + s); ctx.stroke()
    }
    function disc(cx, cy, color, glow) {
      const rad = CELL / 2 - 7
      ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2)
      ctx.fillStyle = color
      if (glow) { ctx.shadowColor = color; ctx.shadowBlur = glow }
      ctx.fill(); ctx.shadowBlur = 0
      // glossy white highlight
      ctx.beginPath(); ctx.arc(cx - rad * 0.32, cy - rad * 0.32, rad * 0.28, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fill()
    }

    function draw() {
      ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, W, H)
      sparkle(W - 18, 20, 5); sparkle(18, H - 20, 4)

      const { p, a } = counts(board)

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
      ctx.fillText(status, W / 2, PAD + 22)
      const tw = ctx.measureText(status).width
      ctx.fillStyle = PINK; ctx.fillRect(W / 2 - tw / 2, PAD + 30, tw, 3)

      // score line
      ctx.font = '600 13px system-ui, sans-serif'
      ctx.textAlign = 'left'
      ctx.fillStyle = PINK; ctx.fillText('● ' + p, PAD, PAD + 50)
      ctx.fillStyle = CYAN; ctx.textAlign = 'right'; ctx.fillText(a + ' ●', W - PAD, PAD + 50)
      ctx.fillStyle = '#8a93ad'; ctx.textAlign = 'center'
      ctx.fillText('BEST +' + best, W / 2, PAD + 50)

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

      // grid lines (subtle pink)
      ctx.strokeStyle = 'rgba(255,45,111,0.18)'; ctx.lineWidth = 1
      for (let i = 0; i <= N; i++) {
        const x = BOARD_X + i * CELL
        ctx.beginPath(); ctx.moveTo(x, BOARD_Y); ctx.lineTo(x, BOARD_Y + BOARD_H); ctx.stroke()
        const y = BOARD_Y + i * CELL
        ctx.beginPath(); ctx.moveTo(BOARD_X, y); ctx.lineTo(BOARD_X + BOARD_W, y); ctx.stroke()
      }

      // legal-move hints for the human
      const humanToMove = state === 'playing' && !lock && (!aiOn || turn === P)
      if (humanToMove) {
        const moves = legalMoves(board, turn)
        const hintColor = turn === P ? PINK : CYAN
        for (const [r, c] of moves) {
          const hovered = hover === idx(r, c)
          ctx.beginPath(); ctx.arc(cellCX(c), cellCY(r), hovered ? 9 : 5, 0, Math.PI * 2)
          ctx.fillStyle = hintColor
          ctx.globalAlpha = hovered ? 0.55 : 0.32
          if (hovered) { ctx.shadowColor = hintColor; ctx.shadowBlur = 12 }
          ctx.fill(); ctx.shadowBlur = 0; ctx.globalAlpha = 1
        }
      }

      // discs
      for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
          const v = board[idx(r, c)]
          if (v) disc(cellCX(c), cellCY(r), v === P ? PINK : CYAN, 14)
        }
      }

      // last-move ring
      if (lastMove && state === 'playing') {
        const [r, c] = lastMove
        const v = board[idx(r, c)]
        ctx.strokeStyle = v === P ? PINK : CYAN
        ctx.lineWidth = 2
        ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 14
        ctx.beginPath(); ctx.arc(cellCX(c), cellCY(r), CELL / 2 - 4, 0, Math.PI * 2); ctx.stroke()
        ctx.shadowBlur = 0
      }

      // hint line
      ctx.fillStyle = '#8a93ad'; ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'center'
      const overHint = 'tap / space to play again'
      const playHint = 'click a dot · R restart · A: ' + (aiOn ? 'switch to 2-player' : 'vs CPU')
      ctx.fillText(state === 'over' ? overHint : playHint, W / 2, H - 8)
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
    <canvas ref={canvasRef} width={W} height={H} className="othello-canvas" aria-label="Othello game" />
  )
}
