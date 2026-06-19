import { useEffect, useRef } from 'react'
import { isAutoplay, shouldAutoWin, recordAutoplayResult } from '../autoplay.js'

// Tic-Tac-Toe on canvas, 10x neon style, with an UNBEATABLE minimax AI.
// The AI plays perfectly (full game-tree search) so it can never lose — at best you draw.
const CELL = 116
const PAD = 24
const HEADER = 52
const GAP = 8
const BOARD = CELL * 3
const BOARD_X = PAD
const BOARD_Y = PAD + HEADER + GAP
const W = PAD * 2 + BOARD
const H = BOARD_Y + BOARD + PAD + 22 // room for hint line

const PINK = '#ff2d6f' // X / human
const CYAN = '#2de2e6' // O / CPU

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
]

function winner(b) {
  for (const [a, c, d] of LINES) if (b[a] && b[a] === b[c] && b[a] === b[d]) return { player: b[a], line: [a, c, d] }
  return null
}
const full = (b) => b.every((x) => x)

// minimax: O (AI) maximizes, X (human) minimizes; depth makes it prefer faster wins / slower losses.
function minimax(b, depth, isAi) {
  const w = winner(b)
  if (w) return w.player === 'O' ? 10 - depth : depth - 10
  if (full(b)) return 0
  if (isAi) {
    let best = -Infinity
    for (let i = 0; i < 9; i++) if (!b[i]) { b[i] = 'O'; best = Math.max(best, minimax(b, depth + 1, false)); b[i] = null }
    return best
  }
  let best = Infinity
  for (let i = 0; i < 9; i++) if (!b[i]) { b[i] = 'X'; best = Math.min(best, minimax(b, depth + 1, true)); b[i] = null }
  return best
}
function bestMove(b) {
  let best = -Infinity, move = -1
  for (let i = 0; i < 9; i++) if (!b[i]) { b[i] = 'O'; const s = minimax(b, 0, false); b[i] = null; if (s > best) { best = s; move = i } }
  return move
}
// Best move for X (X minimizes); used by the autoplay bot for 'good' rounds → forces a draw vs perfect O.
function bestMoveX(b) {
  let best = Infinity, move = -1
  for (let i = 0; i < 9; i++) if (!b[i]) { b[i] = 'X'; const s = minimax(b, 0, true); b[i] = null; if (s < best) { best = s; move = i } }
  return move
}
function randomMove(b) {
  const open = []
  for (let i = 0; i < 9; i++) if (!b[i]) open.push(i)
  return open.length ? open[Math.floor(Math.random() * open.length)] : -1
}

// Returns the cell where `player` would immediately win, or -1.
function winningMove(b, player) {
  for (let i = 0; i < 9; i++) if (!b[i]) { b[i] = player; const w = winner(b); b[i] = null; if (w && w.player === player) return i }
  return -1
}
// Does placing `player` at i create a fork (two simultaneous winning threats)?
function isFork(b, i, player) {
  b[i] = player
  let threats = 0
  for (let j = 0; j < 9; j++) if (!b[j]) { b[j] = player; if (winner(b)) threats++; b[j] = null }
  b[i] = null
  return threats >= 2
}
// Autoplay WIN rounds: X actively hunts for a win.
function winSeekMoveX(b) {
  const win = winningMove(b, 'X'); if (win >= 0) return win        // (a) take the win
  const block = winningMove(b, 'O'); if (block >= 0) return block  // (b) block O's win
  if (!b[4]) return 4                                              // (c) center
  const forks = []                                                 // fork / double-threat
  for (let i = 0; i < 9; i++) if (!b[i] && isFork(b, i, 'X')) forks.push(i)
  if (forks.length) return forks[Math.floor(Math.random() * forks.length)]
  const corners = [0, 2, 6, 8].filter((i) => !b[i])
  if (corners.length) return corners[Math.floor(Math.random() * corners.length)]
  return randomMove(b)
}
// Autoplay WIN rounds: O throws the game — avoids blocking X and avoids winning when possible.
function throwMoveO(b) {
  const open = []
  for (let i = 0; i < 9; i++) if (!b[i]) open.push(i)
  if (!open.length) return -1
  const xWin = winningMove(b, 'X')
  const safe = open.filter((i) => {
    if (i === xWin) return false                                   // don't block X's win
    b[i] = 'O'; const w = winner(b); b[i] = null
    if (w && w.player === 'O') return false                        // don't take own win
    return true
  })
  const pool = safe.length ? safe : open                           // only blocking/winning moves left → random
  return pool[Math.floor(Math.random() * pool.length)]
}

export default function TicTacToe() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const auto = isAutoplay('tic-tac-toe')

    let board, turn, state, result, winLine, aiOn, lock
    let tally = { x: 0, o: 0, d: 0 }
    let aiTimer = 0, raf = 0
    let autoTimer = 0, xSkill = 'good' // 'good' → minimax X; 'sloppy' → random X (loses)
    let wantWin = true // autoplay: this round aims for an X win (→ weaken O so X can actually win)
    let recorded = false // ensure recordAutoplayResult fires exactly once per session

    function reset() {
      board = new Array(9).fill(null)
      turn = 'X'; state = 'playing'; result = null; winLine = null; lock = false
      if (aiOn === undefined) aiOn = true
      if (auto) {
        aiOn = true // O must keep playing
        wantWin = shouldAutoWin('tic-tac-toe')
        xSkill = wantWin ? 'good' : 'sloppy' // win round → strong X; lose round → random X
        recorded = false
        scheduleAuto()
      }
    }

    // Autoplay bot drives the human X side by calling place() on a watchable timer.
    function scheduleAuto() {
      if (!auto) return
      clearTimeout(autoTimer)
      autoTimer = setTimeout(autoStep, 500 + Math.random() * 200)
    }
    function autoStep() {
      if (!auto) return
      if (state === 'over') { autoTimer = setTimeout(reset, 1500); return }
      if (turn === 'X' && !lock) {
        // WIN rounds: X actively hunts a win. LOSE rounds: X plays random (loses to perfect O).
        const i = xSkill === 'good' ? winSeekMoveX(board) : randomMove(board)
        if (i >= 0) place(i)
      }
      scheduleAuto() // keep looping; waits through O's turn / lock until the game ends
    }

    function finish() {
      const w = winner(board)
      if (w) { state = 'over'; result = w.player; winLine = w.line; tally[w.player.toLowerCase()]++ }
      else if (full(board)) { state = 'over'; result = 'draw'; tally.d++ }
      else return false
      if (auto && !recorded) { recorded = true; recordAutoplayResult('tic-tac-toe', result === 'X') }
      return true
    }

    function place(i) {
      if (state === 'over' || lock || board[i]) return
      board[i] = turn
      if (finish()) return
      turn = turn === 'X' ? 'O' : 'X'
      if (aiOn && turn === 'O') scheduleAI()
    }

    function scheduleAI() {
      lock = true
      aiTimer = setTimeout(() => {
        // Human play (and autoplay LOSE rounds): O is the perfect, unbeatable minimax.
        // Autoplay WIN rounds: O throws the game — it avoids blocking X's win and avoids
        // taking its own win whenever possible, so X's threats reliably convert to wins.
        const i = (auto && wantWin) ? throwMoveO(board) : bestMove(board)
        if (i >= 0) board[i] = 'O'
        lock = false
        if (!finish()) turn = 'X'
      }, 450 + Math.random() * 200)
    }

    // ---------- input ----------
    function cellFromXY(e) {
      const rect = canvas.getBoundingClientRect()
      const x = (e.clientX - rect.left) * (W / rect.width) - BOARD_X
      const y = (e.clientY - rect.top) * (H / rect.height) - BOARD_Y
      if (x < 0 || y < 0 || x >= BOARD || y >= BOARD) return -1
      return Math.floor(y / CELL) * 3 + Math.floor(x / CELL)
    }
    function onPointer(e) {
      e.preventDefault()
      if (state === 'over') { reset(); return }
      const i = cellFromXY(e)
      if (i >= 0) place(i)
    }
    function onKey(e) {
      if (e.code === 'KeyR') { e.preventDefault(); clearTimeout(aiTimer); lock = false; reset() }
      else if (e.code === 'KeyA') { if (!e.repeat) { aiOn = !aiOn; clearTimeout(aiTimer); lock = false; reset() } }
    }
    canvas.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)

    // ---------- drawing ----------
    function sparkle(x, y, s) {
      ctx.strokeStyle = PINK; ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(x - s, y); ctx.lineTo(x + s, y); ctx.moveTo(x, y - s); ctx.lineTo(x, y + s); ctx.stroke()
    }
    function drawX(cx, cy) {
      const r = 34
      ctx.strokeStyle = PINK; ctx.lineWidth = 11; ctx.lineCap = 'round'
      ctx.shadowColor = PINK; ctx.shadowBlur = 14
      ctx.beginPath(); ctx.moveTo(cx - r, cy - r); ctx.lineTo(cx + r, cy + r); ctx.moveTo(cx + r, cy - r); ctx.lineTo(cx - r, cy + r); ctx.stroke()
      ctx.shadowBlur = 0
    }
    function drawO(cx, cy) {
      ctx.strokeStyle = CYAN; ctx.lineWidth = 11
      ctx.shadowColor = CYAN; ctx.shadowBlur = 14
      ctx.beginPath(); ctx.arc(cx, cy, 34, 0, Math.PI * 2); ctx.stroke()
      ctx.shadowBlur = 0
    }

    function draw() {
      ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, W, H)
      sparkle(W - 24, 22, 5); sparkle(24, H - 22, 4)

      // status
      let status, color = '#fff'
      if (state === 'over') {
        if (result === 'draw') { status = 'DRAW'; color = '#8a93ad' }
        else if (aiOn) { status = result === 'X' ? 'YOU WIN!' : 'CPU WINS'; color = result === 'X' ? PINK : CYAN }
        else { status = 'PLAYER ' + result + ' WINS'; color = result === 'X' ? PINK : CYAN }
      } else if (aiOn) { status = turn === 'X' ? 'YOUR TURN' : 'CPU THINKING…'; color = turn === 'X' ? PINK : CYAN }
      else { status = 'PLAYER ' + turn; color = turn === 'X' ? PINK : CYAN }
      ctx.fillStyle = color; ctx.font = '800 26px system-ui, sans-serif'; ctx.textAlign = 'center'
      ctx.fillText(status, W / 2, PAD + 22)
      // tally
      ctx.font = '600 12px system-ui, sans-serif'; ctx.fillStyle = '#8a93ad'
      const t = aiOn ? `YOU ${tally.x}   ·   CPU ${tally.o}   ·   DRAW ${tally.d}` : `X ${tally.x}   ·   O ${tally.o}   ·   DRAW ${tally.d}`
      ctx.fillText(t, W / 2, PAD + 42)

      // grid lines
      ctx.strokeStyle = 'rgba(255,45,111,0.55)'; ctx.lineWidth = 3
      for (let i = 1; i < 3; i++) {
        ctx.beginPath(); ctx.moveTo(BOARD_X + i * CELL, BOARD_Y + 6); ctx.lineTo(BOARD_X + i * CELL, BOARD_Y + BOARD - 6); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(BOARD_X + 6, BOARD_Y + i * CELL); ctx.lineTo(BOARD_X + BOARD - 6, BOARD_Y + i * CELL); ctx.stroke()
      }

      // marks
      for (let i = 0; i < 9; i++) {
        if (!board[i]) continue
        const cx = BOARD_X + (i % 3) * CELL + CELL / 2
        const cy = BOARD_Y + Math.floor(i / 3) * CELL + CELL / 2
        if (board[i] === 'X') drawX(cx, cy); else drawO(cx, cy)
      }

      // winning line
      if (winLine) {
        const [a, , c] = winLine
        const p = (i) => [BOARD_X + (i % 3) * CELL + CELL / 2, BOARD_Y + Math.floor(i / 3) * CELL + CELL / 2]
        const [x1, y1] = p(a), [x2, y2] = p(c)
        ctx.strokeStyle = result === 'X' ? PINK : CYAN; ctx.lineWidth = 7; ctx.lineCap = 'round'
        ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 18
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.shadowBlur = 0
      }

      // hint
      ctx.fillStyle = '#8a93ad'; ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'center'
      ctx.fillText('click a square · R restart · A: ' + (aiOn ? 'switch to 2-player' : 'vs unbeatable CPU'), W / 2, H - 8)
    }

    function loop() { draw(); raf = requestAnimationFrame(loop) }

    reset()
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(aiTimer)
      clearTimeout(autoTimer)
      canvas.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  return (
    <canvas ref={canvasRef} width={W} height={H} className="ttt-canvas" aria-label="Tic-Tac-Toe game" />
  )
}
