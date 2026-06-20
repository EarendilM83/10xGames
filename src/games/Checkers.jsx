import { useEffect, useRef } from 'react'
import { isAutoplay, shouldAutoWin, recordAutoplayResult } from '../autoplay.js'

// 8x8 American checkers on canvas, 10x neon style, with an alpha-beta minimax AI.
// Player = pink (bottom, moves up). AI = cyan (top, moves down).
// Forced capture, multi-jump chaining and kinging are enforced for both sides.
const N = 8
const CELL = 56
const PAD = 16
const HEADER = 60
const BOARD = N * CELL
const BOARD_X = PAD
const BOARD_Y = PAD + HEADER
const W = PAD * 2 + BOARD // 480
const H = BOARD_Y + BOARD + PAD + 16 // 540

const PINK = '#ff2d6f' // human, bottom
const CYAN = '#2de2e6' // ai, top
const DARK_SQ = '#15151c'
const LIGHT_SQ = '#101016'

// Piece encoding: 0 empty. 1 pink man, 2 pink king, 3 cyan man, 4 cyan king.
const PINK_MAN = 1, PINK_KING = 2, CYAN_MAN = 3, CYAN_KING = 4
const isPink = (p) => p === PINK_MAN || p === PINK_KING
const isCyan = (p) => p === CYAN_MAN || p === CYAN_KING
const isKing = (p) => p === PINK_KING || p === CYAN_KING
const owner = (p) => (p === 0 ? 0 : isPink(p) ? 1 : 2) // 1 = pink/player, 2 = cyan/ai
const DEPTH = 6

const idx = (r, c) => r * N + c
const inBounds = (r, c) => r >= 0 && r < N && c >= 0 && c < N
const isDark = (r, c) => (r + c) % 2 === 1 // playable squares

function makeBoard() {
  const b = new Array(N * N).fill(0)
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (!isDark(r, c)) continue
      if (r < 3) b[idx(r, c)] = CYAN_MAN // top
      else if (r > 4) b[idx(r, c)] = PINK_MAN // bottom
    }
  }
  return b
}

// Movement directions. Men: pink up (dr -1), cyan down (dr +1). Kings: all four.
function dirsFor(p) {
  if (p === PINK_MAN) return [[-1, -1], [-1, 1]]
  if (p === CYAN_MAN) return [[1, -1], [1, 1]]
  return [[-1, -1], [-1, 1], [1, -1], [1, 1]] // kings
}

// Generate capture moves for one piece at (r,c). Returns array of move objects.
// A move = { from:[r,c], to:[r,c], captures:[[r,c],...], path:[[r,c],...] } where
// captures lists every jumped piece in order (multi-jump chains).
function captureMoves(b, r, c) {
  const piece = b[idx(r, c)]
  if (!piece) return []
  const results = []

  // recurse mutates the board to reflect the chain so far, then restores it.
  // curR/curC = current position of the jumping piece; captured = jumped squares.
  function recurse(curR, curC, curPiece, captured, path) {
    let extendedAny = false
    for (const [dr, dc] of dirsFor(curPiece)) {
      const midR = curR + dr, midC = curC + dc
      const landR = curR + dr * 2, landC = curC + dc * 2
      if (!inBounds(landR, landC) || !isDark(landR, landC)) continue
      const mid = b[idx(midR, midC)]
      if (!mid || owner(mid) === owner(curPiece)) continue
      if (captured.some(([cr, cc]) => cr === midR && cc === midC)) continue // already jumped
      if (b[idx(landR, landC)] !== 0) continue // landing must be empty

      // apply this single jump to the board
      b[idx(curR, curC)] = 0
      b[idx(midR, midC)] = 0
      let np = curPiece
      let becameKing = false
      if (curPiece === PINK_MAN && landR === 0) { np = PINK_KING; becameKing = true }
      else if (curPiece === CYAN_MAN && landR === N - 1) { np = CYAN_KING; becameKing = true }
      b[idx(landR, landC)] = np

      const newCaptured = captured.concat([[midR, midC]])
      const newPath = path.concat([[landR, landC]])
      extendedAny = true

      // Reaching the king row ends the chain (standard American rule). Otherwise
      // try to extend; if no extension exists, this jump is a terminal move.
      let extendedHere = false
      if (!becameKing) extendedHere = recurse(landR, landC, np, newCaptured, newPath)
      if (becameKing || !extendedHere) {
        results.push({ from: path[0], to: [landR, landC], captures: newCaptured, path: newPath })
      }

      // restore the board
      b[idx(landR, landC)] = 0
      b[idx(midR, midC)] = mid
      b[idx(curR, curC)] = curPiece
    }
    return extendedAny
  }

  recurse(r, c, piece, [], [[r, c]])
  return results
}

// Simple (non-capturing) moves for one piece.
function simpleMoves(b, r, c) {
  const piece = b[idx(r, c)]
  if (!piece) return []
  const out = []
  for (const [dr, dc] of dirsFor(piece)) {
    const nr = r + dr, nc = c + dc
    if (!inBounds(nr, nc) || !isDark(nr, nc)) continue
    if (b[idx(nr, nc)] !== 0) continue
    out.push({ from: [r, c], to: [nr, nc], captures: [], path: [[r, c], [nr, nc]] })
  }
  return out
}

// All legal moves for a side (1 = player/pink, 2 = ai/cyan), enforcing forced capture.
function legalMoves(b, side) {
  const caps = []
  const simples = []
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const p = b[idx(r, c)]
      if (!p || owner(p) !== side) continue
      const cm = captureMoves(b, r, c)
      if (cm.length) caps.push(...cm)
      else simples.push(...simpleMoves(b, r, c))
    }
  }
  return caps.length ? caps : simples
}

// Apply a move to a board (mutates), returns undo info for reversal in search.
function applyMove(b, m) {
  const [fr, fc] = m.from
  const [tr, tc] = m.to
  const piece = b[idx(fr, fc)]
  const captured = m.captures.map(([cr, cc]) => [cr, cc, b[idx(cr, cc)]])
  b[idx(fr, fc)] = 0
  for (const [cr, cc] of m.captures) b[idx(cr, cc)] = 0
  let np = piece
  if (piece === PINK_MAN && tr === 0) np = PINK_KING
  else if (piece === CYAN_MAN && tr === N - 1) np = CYAN_KING
  b[idx(tr, tc)] = np
  return { piece, np, captured, fr, fc, tr, tc }
}
function undoMove(b, u) {
  b[idx(u.tr, u.tc)] = 0
  b[idx(u.fr, u.fc)] = u.piece
  for (const [cr, cc, v] of u.captured) b[idx(cr, cc)] = v
}

// Evaluation from AI (cyan / side 2) perspective. Material + advancement + back-row.
function evaluate(b) {
  let score = 0
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const p = b[idx(r, c)]
      if (!p) continue
      const sign = isCyan(p) ? 1 : -1
      let v = isKing(p) ? 1.6 : 1.0
      // advancement: men want to march toward kinging row
      if (p === CYAN_MAN) v += r * 0.04 // cyan advances downward (r grows)
      else if (p === PINK_MAN) v += (N - 1 - r) * 0.04 // pink advances upward
      // back-row safety: keep the home rank guarded
      if (p === CYAN_MAN && r === 0) v += 0.12
      else if (p === PINK_MAN && r === N - 1) v += 0.12
      score += sign * v
    }
  }
  return score
}

// Minimax with alpha-beta. maximizing => AI (cyan) to move.
function minimax(b, depth, alpha, beta, maximizing) {
  const side = maximizing ? 2 : 1
  const moves = legalMoves(b, side)
  if (moves.length === 0) {
    // side to move has no moves => it loses
    return maximizing ? -100000 - depth : 100000 + depth
  }
  if (depth === 0) return evaluate(b)

  if (maximizing) {
    let best = -Infinity
    for (const m of moves) {
      const u = applyMove(b, m)
      const s = minimax(b, depth - 1, alpha, beta, false)
      undoMove(b, u)
      if (s > best) best = s
      if (best > alpha) alpha = best
      if (alpha >= beta) break
    }
    return best
  } else {
    let best = Infinity
    for (const m of moves) {
      const u = applyMove(b, m)
      const s = minimax(b, depth - 1, alpha, beta, true)
      undoMove(b, u)
      if (s < best) best = s
      if (best < beta) beta = best
      if (alpha >= beta) break
    }
    return best
  }
}

function aiBestMove(b) {
  const moves = legalMoves(b, 2)
  if (moves.length === 0) return null
  let bestScore = -Infinity
  let best = moves[0]
  for (const m of moves) {
    const u = applyMove(b, m)
    const s = minimax(b, DEPTH - 1, -Infinity, Infinity, false)
    undoMove(b, u)
    if (s > bestScore) { bestScore = s; best = m }
  }
  return best
}

function countPieces(b, side) {
  let n = 0
  for (let i = 0; i < b.length; i++) if (b[i] && owner(b[i]) === side) n++
  return n
}

const BEST_KEY = '10xgames.checkers.best'

export default function Checkers() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const auto = isAutoplay('checkers')
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')

    let board, turn, state, result, aiOn, lock
    let autoTimer = 0, autoRestart = 0, autoSkill = 'good'
    let wantWin = true // in autoplay: should pink win this round?
    let moveCount = 0 // total plies this round, for the no-winner safeguard
    const MOVE_CAP = 200 // if a round runs this long with no winner, end it as not-a-win
    let selected = null // [r,c] of selected piece
    let legalForSel = [] // legal move objects originating from the selected piece
    let allLegal = [] // all legal moves for the side to move (forced-capture aware)
    let streak = 0
    let best = 0
    try { best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0 } catch { best = 0 }
    let aiTimer = 0, raf = 0

    function refreshLegal() {
      allLegal = legalMoves(board, turn)
    }

    function reset() {
      board = makeBoard()
      turn = 1 // pink/player moves first
      state = 'playing'
      result = null
      selected = null
      legalForSel = []
      lock = false
      if (auto) aiOn = true // CPU (cyan) must stay enabled so pink plays vs AI
      else if (aiOn === undefined) aiOn = true
      moveCount = 0
      refreshLegal()
      if (auto) {
        // Decide the outcome for this round, then play to it:
        //  win  -> pink plays strong (minimax), cyan is weakened to random legal moves
        //  lose -> pink plays random legal moves, cyan plays strong (minimax)
        wantWin = shouldAutoWin('checkers')
        autoSkill = wantWin ? 'good' : 'sloppy'
        scheduleAuto() // pink moves first
      }
    }

    function checkEnd() {
      // current side (turn) to move; if no legal moves or no pieces, they lose.
      const decided = countPieces(board, 1) === 0 || countPieces(board, 2) === 0 || allLegal.length === 0
      // Safeguard: a game with no winner (endless shuffling / king dance) must not hang
      // the autoplay loop. Past the move cap, end the round with no winner (not-a-win).
      const capped = auto && !decided && moveCount >= MOVE_CAP
      if (decided || capped) {
        state = 'over'
        // the side to move has lost -> opponent wins; capped = draw (no winner)
        result = capped ? 0 : (turn === 1 ? 2 : 1)
        const pinkWon = result === 1
        if (aiOn) {
          if (pinkWon) { streak += 1; if (streak > best) { best = streak; try { localStorage.setItem(BEST_KEY, String(best)) } catch {} } }
          else streak = 0
        }
        if (auto) {
          recordAutoplayResult('checkers', pinkWon === true)
          clearTimeout(autoRestart); autoRestart = setTimeout(reset, 1600)
        }
        return true
      }
      return false
    }

    function endTurn() {
      moveCount += 1
      turn = turn === 1 ? 2 : 1
      selected = null
      legalForSel = []
      refreshLegal()
      if (checkEnd()) return
      if (aiOn && turn === 2) scheduleAI()
      else if (auto && turn === 1) scheduleAuto()
    }

    // ---------- autoplay (self-play demo) ----------
    // Drives pink (side 1) by calling the game's own applyMove + endTurn on a timer.
    // 'good' uses minimax (pink minimizes cyan's eval). 'sloppy' picks a random legal move.
    function pinkBestMove(b) {
      const moves = legalMoves(b, 1)
      if (moves.length === 0) return null
      let bestScore = Infinity
      let best = moves[0]
      for (const m of moves) {
        const u = applyMove(b, m)
        const s = minimax(b, DEPTH - 1, -Infinity, Infinity, true)
        undoMove(b, u)
        if (s < bestScore) { bestScore = s; best = m }
      }
      return best
    }

    function autoPlayMove() {
      if (!auto || state === 'over') return
      // Self-healing: if it isn't pink's turn yet, or cyan's move/capture chain is
      // still in flight (lock), don't drop the tick — retry shortly so the loop
      // never stalls with no pending timer.
      if (turn !== 1 || lock) { scheduleAuto(); return }
      const m = autoSkill === 'good' ? pinkBestMove(board) : (() => {
        const ms = legalMoves(board, 1)
        return ms.length ? ms[Math.floor(Math.random() * ms.length)] : null
      })()
      if (m) {
        applyMove(board, m)
        endTurn()
      } else {
        // Pink has no legal move => pink loses. endTurn() advances the turn and
        // checkEnd() will detect the (now cyan-to-move-but-pink-lost) terminal
        // state; here turn is still 1 with no moves, so checkEnd ends it directly.
        checkEnd()
      }
    }

    function scheduleAuto() {
      if (!auto) return
      clearTimeout(autoTimer)
      autoTimer = setTimeout(autoPlayMove, 600)
    }

    function scheduleAI() {
      lock = true
      aiTimer = setTimeout(() => {
        // In autoplay WIN rounds, weaken cyan to a random legal move (forced-capture
        // is still respected by legalMoves) so pink reliably wins. Human play and
        // autoplay LOSE rounds keep cyan at full minimax strength.
        const weakCyan = auto && wantWin
        const m = weakCyan
          ? (() => {
              const ms = legalMoves(board, 2)
              return ms.length ? ms[Math.floor(Math.random() * ms.length)] : null
            })()
          : aiBestMove(board)
        lock = false
        if (m) {
          applyMove(board, m)
          endTurn()
        }
      }, 350)
    }

    function selectPiece(r, c) {
      const moves = allLegal.filter((m) => m.from[0] === r && m.from[1] === c)
      if (!moves.length) { selected = null; legalForSel = []; return }
      selected = [r, c]
      legalForSel = moves
    }

    function tryPlayerAction(r, c) {
      if (state === 'over' || lock) return
      if (aiOn && turn !== 1) return
      // if a piece is selected and (r,c) is a legal destination, move there
      if (selected) {
        const m = legalForSel.find((mm) => mm.to[0] === r && mm.to[1] === c)
        if (m) {
          applyMove(board, m)
          endTurn()
          return
        }
      }
      // otherwise (re)select if it's the player's own piece with legal moves
      const p = board[idx(r, c)]
      if (p && owner(p) === turn) selectPiece(r, c)
      else { selected = null; legalForSel = [] }
    }

    // ---------- input ----------
    function cellFromEvent(e) {
      const rect = canvas.getBoundingClientRect()
      const scale = W / rect.width
      const x = (e.clientX - rect.left) * scale - BOARD_X
      const y = (e.clientY - rect.top) * scale - BOARD_Y
      if (x < 0 || x >= BOARD || y < 0 || y >= BOARD) return null
      return [Math.floor(y / CELL), Math.floor(x / CELL)]
    }
    function onPointer(e) {
      e.preventDefault()
      if (state === 'over') { reset(); return }
      const cell = cellFromEvent(e)
      if (!cell) return
      tryPlayerAction(cell[0], cell[1])
    }
    function onKey(e) {
      if (e.code === 'KeyR') { e.preventDefault(); clearTimeout(aiTimer); lock = false; reset() }
      else if (e.code === 'KeyA') {
        if (!e.repeat) { aiOn = !aiOn; clearTimeout(aiTimer); lock = false; streak = 0; reset() }
      } else if (e.code === 'Space') { e.preventDefault(); if (state === 'over') reset() }
    }
    canvas.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)

    // ---------- drawing ----------
    const sqX = (c) => BOARD_X + c * CELL
    const sqY = (r) => BOARD_Y + r * CELL
    const ctrX = (c) => sqX(c) + CELL / 2
    const ctrY = (r) => sqY(r) + CELL / 2

    function sparkle(x, y, s) {
      ctx.strokeStyle = PINK; ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(x - s, y); ctx.lineTo(x + s, y)
      ctx.moveTo(x, y - s); ctx.lineTo(x, y + s)
      ctx.stroke()
    }

    function drawPiece(r, c, p) {
      const cx = ctrX(c), cy = ctrY(r)
      const rad = CELL / 2 - 8
      const color = isPink(p) ? PINK : CYAN
      // glow disc
      ctx.shadowColor = color; ctx.shadowBlur = 16
      ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2)
      ctx.fillStyle = color; ctx.fill()
      ctx.shadowBlur = 0
      // glossy inner highlight
      const grad = ctx.createRadialGradient(cx - rad * 0.3, cy - rad * 0.35, rad * 0.1, cx, cy, rad)
      grad.addColorStop(0, 'rgba(255,255,255,0.55)')
      grad.addColorStop(0.4, 'rgba(255,255,255,0.08)')
      grad.addColorStop(1, 'rgba(0,0,0,0.25)')
      ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2)
      ctx.fillStyle = grad; ctx.fill()
      // rim
      ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 2; ctx.stroke()
      // king crown ring
      if (isKing(p)) {
        ctx.beginPath(); ctx.arc(cx, cy, rad * 0.5, 0, Math.PI * 2)
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.5
        ctx.shadowColor = '#ffffff'; ctx.shadowBlur = 8
        ctx.stroke(); ctx.shadowBlur = 0
      }
    }

    function draw() {
      ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, W, H)
      sparkle(W - 18, 20, 5); sparkle(18, H - 20, 4)

      // status
      let status, color = '#fff'
      if (state === 'over') {
        if (aiOn) { status = result === 1 ? 'YOU WIN' : 'CPU WINS'; color = result === 1 ? PINK : CYAN }
        else { status = (result === 1 ? 'PINK' : 'CYAN') + ' WINS'; color = result === 1 ? PINK : CYAN }
      } else if (aiOn) {
        status = turn === 1 ? 'YOUR TURN' : 'CPU THINKING…'; color = turn === 1 ? PINK : CYAN
      } else {
        status = (turn === 1 ? 'PINK' : 'CYAN') + ' TURN'; color = turn === 1 ? PINK : CYAN
      }
      ctx.textAlign = 'center'
      ctx.fillStyle = color; ctx.font = '800 26px system-ui, sans-serif'
      ctx.fillText(status, W / 2, PAD + 24)
      const tw = ctx.measureText(status).width
      ctx.fillStyle = PINK; ctx.fillRect(W / 2 - tw / 2, PAD + 32, tw, 3)
      // sub line
      ctx.font = '600 12px system-ui, sans-serif'; ctx.fillStyle = '#8a93ad'
      const sub = aiOn
        ? `STREAK ${streak}   ·   BEST ${best}`
        : `PINK ${countPieces(board, 1)}   ·   CYAN ${countPieces(board, 2)}`
      ctx.fillText(sub, W / 2, PAD + 50)

      // board frame
      ctx.strokeStyle = 'rgba(255,45,111,0.45)'; ctx.lineWidth = 2
      ctx.strokeRect(BOARD_X - 2, BOARD_Y - 2, BOARD + 4, BOARD + 4)

      // squares
      for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
          ctx.fillStyle = isDark(r, c) ? DARK_SQ : LIGHT_SQ
          ctx.fillRect(sqX(c), sqY(r), CELL, CELL)
        }
      }

      // selected highlight
      if (selected) {
        const [sr, sc] = selected
        ctx.fillStyle = 'rgba(255,45,111,0.22)'
        ctx.fillRect(sqX(sc), sqY(sr), CELL, CELL)
        ctx.strokeStyle = PINK; ctx.lineWidth = 2
        ctx.strokeRect(sqX(sc) + 2, sqY(sr) + 2, CELL - 4, CELL - 4)
      }

      // legal target hints for selected piece
      for (const m of legalForSel) {
        const [tr, tc] = m.to
        ctx.beginPath()
        ctx.arc(ctrX(tc), ctrY(tr), 8, 0, Math.PI * 2)
        const isCap = m.captures.length > 0
        ctx.fillStyle = isCap ? 'rgba(255,214,10,0.85)' : 'rgba(255,255,255,0.55)'
        ctx.shadowColor = isCap ? '#ffd60a' : '#ffffff'; ctx.shadowBlur = 10
        ctx.fill(); ctx.shadowBlur = 0
      }

      // pieces
      for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
          const p = board[idx(r, c)]
          if (p) drawPiece(r, c, p)
        }
      }

      // hint line
      ctx.fillStyle = '#8a93ad'; ctx.font = '600 11px system-ui, sans-serif'
      const overHint = 'tap / space to play again'
      const playHint = 'click piece then target · R restart · A: ' + (aiOn ? 'switch to 2-player' : 'vs CPU')
      ctx.fillText(state === 'over' ? overHint : playHint, W / 2, H - 6)
    }

    function loop() { draw(); raf = requestAnimationFrame(loop) }

    reset()
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(aiTimer)
      clearTimeout(autoTimer)
      clearTimeout(autoRestart)
      canvas.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  return (
    <canvas ref={canvasRef} width={W} height={H} className="checkers-canvas" aria-label="Checkers game" />
  )
}
