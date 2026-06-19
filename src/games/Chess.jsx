import { useEffect, useRef } from 'react'
import { isAutoplay, shouldAutoWin, recordAutoplayResult } from '../autoplay.js'

// 8x8 chess on canvas, 10x neon style, with an alpha-beta minimax AI.
// Player = White (bottom). AI = Black (top). Full legal move generation:
// pawn double-step / diagonal capture / en passant / auto-queen promotion,
// knight, bishop, rook, queen, king, castling (both sides) with all checks,
// and king-safety filtering so you can never leave/move into check.
const N = 8
const CELL = 56
const PAD = 16
const HEADER = 60
const BOARD = N * CELL
const BOARD_X = PAD
const BOARD_Y = PAD + HEADER
const W = PAD * 2 + BOARD // 480
const H = BOARD_Y + BOARD + PAD + 16 // 540

const PINK = '#ff2d6f'
const CYAN = '#2de2e6'
const WHITE_PC = '#f5f6fa'
const DARK_SQ = '#1f1f2a'
const LIGHT_SQ = '#15151c'

// Board is a 64-length array. Empty = null. Piece = { t, w } where
// t in {'p','n','b','r','q','k'} and w = true for White, false for Black.
const WHITE = true
const BLACK = false

const idx = (r, c) => r * 8 + c
const inB = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8

// Unicode glyphs.
const GLYPH = {
  k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟',
}

const VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 }

// Piece-square tables (from White's perspective, row 0 = top/Black side, row 7 = White side).
// We index by absolute board row; for White pieces we mirror (read row 7-r).
const PST = {
  p: [
    0, 0, 0, 0, 0, 0, 0, 0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
    5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0,
    5, -5, -10, 0, 0, -10, -5, 5,
    5, 10, 10, -20, -20, 10, 10, 5,
    0, 0, 0, 0, 0, 0, 0, 0,
  ],
  n: [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20, 0, 0, 0, 0, -20, -40,
    -30, 0, 10, 15, 15, 10, 0, -30,
    -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30,
    -30, 5, 10, 15, 15, 10, 5, -30,
    -40, -20, 0, 5, 5, 0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  b: [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 10, 10, 5, 0, -10,
    -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10,
    -10, 10, 10, 10, 10, 10, 10, -10,
    -10, 5, 0, 0, 0, 0, 5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20,
  ],
  r: [
    0, 0, 0, 0, 0, 0, 0, 0,
    5, 10, 10, 10, 10, 10, 10, 5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    0, 0, 0, 5, 5, 0, 0, 0,
  ],
  q: [
    -20, -10, -10, -5, -5, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 5, 5, 5, 0, -10,
    -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5,
    -10, 5, 5, 5, 5, 5, 0, -10,
    -10, 0, 5, 0, 0, 0, 0, -10,
    -20, -10, -10, -5, -5, -10, -10, -20,
  ],
  k: [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
    20, 20, 0, 0, 0, 0, 20, 20,
    20, 30, 10, 0, 0, 10, 30, 20,
  ],
}

// Game state object carried through search: { board, castle, ep }
// castle = { wk, wq, bk, bq } booleans (right still available).
// ep = en-passant target square index (the empty square a pawn skipped over) or -1.
function initialState() {
  const b = new Array(64).fill(null)
  const back = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r']
  for (let c = 0; c < 8; c++) {
    b[idx(0, c)] = { t: back[c], w: BLACK }
    b[idx(1, c)] = { t: 'p', w: BLACK }
    b[idx(6, c)] = { t: 'p', w: WHITE }
    b[idx(7, c)] = { t: back[c], w: WHITE }
  }
  return { board: b, castle: { wk: true, wq: true, bk: true, bq: true }, ep: -1 }
}

function findKing(board, white) {
  for (let i = 0; i < 64; i++) {
    const p = board[i]
    if (p && p.t === 'k' && p.w === white) return i
  }
  return -1
}

// Is square (r,c) attacked by the given side (attackerWhite)?
function isAttacked(board, r, c, attackerWhite) {
  // Pawn attacks: a white pawn attacks upward (toward row 0), so a square at (r,c)
  // is attacked by a white pawn sitting at (r+1, c±1).
  const pr = attackerWhite ? r + 1 : r - 1
  for (const dc of [-1, 1]) {
    const cc = c + dc
    if (inB(pr, cc)) {
      const p = board[idx(pr, cc)]
      if (p && p.t === 'p' && p.w === attackerWhite) return true
    }
  }
  // Knight.
  const kn = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]
  for (const [dr, dc] of kn) {
    const rr = r + dr, cc = c + dc
    if (inB(rr, cc)) {
      const p = board[idx(rr, cc)]
      if (p && p.t === 'n' && p.w === attackerWhite) return true
    }
  }
  // King (adjacent).
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue
      const rr = r + dr, cc = c + dc
      if (inB(rr, cc)) {
        const p = board[idx(rr, cc)]
        if (p && p.t === 'k' && p.w === attackerWhite) return true
      }
    }
  }
  // Sliding: rook/queen (orthogonal), bishop/queen (diagonal).
  const ortho = [[-1, 0], [1, 0], [0, -1], [0, 1]]
  for (const [dr, dc] of ortho) {
    let rr = r + dr, cc = c + dc
    while (inB(rr, cc)) {
      const p = board[idx(rr, cc)]
      if (p) {
        if (p.w === attackerWhite && (p.t === 'r' || p.t === 'q')) return true
        break
      }
      rr += dr; cc += dc
    }
  }
  const diag = [[-1, -1], [-1, 1], [1, -1], [1, 1]]
  for (const [dr, dc] of diag) {
    let rr = r + dr, cc = c + dc
    while (inB(rr, cc)) {
      const p = board[idx(rr, cc)]
      if (p) {
        if (p.w === attackerWhite && (p.t === 'b' || p.t === 'q')) return true
        break
      }
      rr += dr; cc += dc
    }
  }
  return false
}

function inCheck(board, white) {
  const k = findKing(board, white)
  if (k < 0) return false
  return isAttacked(board, Math.floor(k / 8), k % 8, !white)
}

// Move = { from, to, piece, promo?, ep?(bool capture-by-ep), castle?('K'|'Q'),
//          double?(bool pawn two-step) }
// Pseudo-legal move generation for the side to move (white).
function pseudoMoves(state, white) {
  const { board, castle, ep } = state
  const moves = []
  const add = (from, to, extra) => moves.push({ from, to, ...extra })

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[idx(r, c)]
      if (!p || p.w !== white) continue
      const from = idx(r, c)
      if (p.t === 'p') {
        const dir = white ? -1 : 1
        const startRow = white ? 6 : 1
        const lastRow = white ? 0 : 7
        const r1 = r + dir
        // forward 1
        if (inB(r1, c) && !board[idx(r1, c)]) {
          if (r1 === lastRow) add(from, idx(r1, c), { promo: 'q' })
          else add(from, idx(r1, c), {})
          // forward 2
          const r2 = r + dir * 2
          if (r === startRow && !board[idx(r2, c)]) add(from, idx(r2, c), { double: true })
        }
        // captures
        for (const dc of [-1, 1]) {
          const cc = c + dc
          if (!inB(r1, cc)) continue
          const tgt = board[idx(r1, cc)]
          if (tgt && tgt.w !== white) {
            if (r1 === lastRow) add(from, idx(r1, cc), { promo: 'q' })
            else add(from, idx(r1, cc), {})
          } else if (idx(r1, cc) === ep) {
            // en passant
            add(from, idx(r1, cc), { ep: true })
          }
        }
      } else if (p.t === 'n') {
        const kn = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]
        for (const [dr, dc] of kn) {
          const rr = r + dr, cc = c + dc
          if (!inB(rr, cc)) continue
          const tgt = board[idx(rr, cc)]
          if (!tgt || tgt.w !== white) add(from, idx(rr, cc), {})
        }
      } else if (p.t === 'k') {
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (!dr && !dc) continue
            const rr = r + dr, cc = c + dc
            if (!inB(rr, cc)) continue
            const tgt = board[idx(rr, cc)]
            if (!tgt || tgt.w !== white) add(from, idx(rr, cc), {})
          }
        }
        // castling
        const homeRow = white ? 7 : 0
        if (r === homeRow && c === 4) {
          const kRight = white ? castle.wk : castle.bk
          const qRight = white ? castle.wq : castle.bq
          const enemy = !white
          if (kRight) {
            // squares f,g empty; rook on h; king not in check, f & g not attacked
            if (!board[idx(homeRow, 5)] && !board[idx(homeRow, 6)]) {
              const rook = board[idx(homeRow, 7)]
              if (rook && rook.t === 'r' && rook.w === white) {
                if (!isAttacked(board, homeRow, 4, enemy) &&
                    !isAttacked(board, homeRow, 5, enemy) &&
                    !isAttacked(board, homeRow, 6, enemy)) {
                  add(from, idx(homeRow, 6), { castle: 'K' })
                }
              }
            }
          }
          if (qRight) {
            // squares b,c,d empty; rook on a; king not in check, d & c not attacked
            if (!board[idx(homeRow, 1)] && !board[idx(homeRow, 2)] && !board[idx(homeRow, 3)]) {
              const rook = board[idx(homeRow, 0)]
              if (rook && rook.t === 'r' && rook.w === white) {
                if (!isAttacked(board, homeRow, 4, enemy) &&
                    !isAttacked(board, homeRow, 3, enemy) &&
                    !isAttacked(board, homeRow, 2, enemy)) {
                  add(from, idx(homeRow, 2), { castle: 'Q' })
                }
              }
            }
          }
        }
      } else {
        // sliding pieces
        let dirs
        if (p.t === 'b') dirs = [[-1, -1], [-1, 1], [1, -1], [1, 1]]
        else if (p.t === 'r') dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]]
        else dirs = [[-1, -1], [-1, 1], [1, -1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]]
        for (const [dr, dc] of dirs) {
          let rr = r + dr, cc = c + dc
          while (inB(rr, cc)) {
            const tgt = board[idx(rr, cc)]
            if (!tgt) add(from, idx(rr, cc), {})
            else { if (tgt.w !== white) add(from, idx(rr, cc), {}); break }
            rr += dr; cc += dc
          }
        }
      }
    }
  }
  return moves
}

// Apply move to state (mutates board), returns undo info.
function applyMove(state, m) {
  const b = state.board
  const moving = b[m.from]
  const captured = b[m.to]
  const undo = {
    from: m.from, to: m.to, moving, captured,
    castle: { ...state.castle }, ep: state.ep,
    epCapSq: -1, epCapPiece: null,
    rookFrom: -1, rookTo: -1, rookPiece: null,
    promo: m.promo || null,
  }

  // move piece
  b[m.to] = moving
  b[m.from] = null

  // promotion
  if (m.promo) b[m.to] = { t: m.promo, w: moving.w }

  // en passant capture: remove the pawn behind the target square
  if (m.ep) {
    const dir = moving.w ? 1 : -1 // captured pawn sits one row "behind" the ep target
    const capSq = m.to + dir * 8
    undo.epCapSq = capSq
    undo.epCapPiece = b[capSq]
    b[capSq] = null
  }

  // castling: move the rook
  if (m.castle) {
    const homeRow = moving.w ? 7 : 0
    if (m.castle === 'K') {
      const rf = idx(homeRow, 7), rt = idx(homeRow, 5)
      undo.rookFrom = rf; undo.rookTo = rt; undo.rookPiece = b[rf]
      b[rt] = b[rf]; b[rf] = null
    } else {
      const rf = idx(homeRow, 0), rt = idx(homeRow, 3)
      undo.rookFrom = rf; undo.rookTo = rt; undo.rookPiece = b[rf]
      b[rt] = b[rf]; b[rf] = null
    }
  }

  // update castling rights
  const cst = state.castle
  if (moving.t === 'k') {
    if (moving.w) { cst.wk = false; cst.wq = false }
    else { cst.bk = false; cst.bq = false }
  }
  // rook moved off its home square
  if (m.from === idx(7, 0)) cst.wq = false
  if (m.from === idx(7, 7)) cst.wk = false
  if (m.from === idx(0, 0)) cst.bq = false
  if (m.from === idx(0, 7)) cst.bk = false
  // rook captured on its home square
  if (m.to === idx(7, 0)) cst.wq = false
  if (m.to === idx(7, 7)) cst.wk = false
  if (m.to === idx(0, 0)) cst.bq = false
  if (m.to === idx(0, 7)) cst.bk = false

  // update ep target
  state.ep = m.double ? (m.from + m.to) / 2 : -1

  return undo
}

function undoMove(state, u) {
  const b = state.board
  b[u.from] = u.moving
  b[u.to] = u.captured
  if (u.promo) b[u.from] = u.moving // moving already the pawn
  if (u.epCapSq >= 0) b[u.epCapSq] = u.epCapPiece
  if (u.rookFrom >= 0) { b[u.rookFrom] = u.rookPiece; b[u.rookTo] = null }
  state.castle = u.castle
  state.ep = u.ep
}

// Legal moves: filter pseudo-legal by king safety.
function legalMoves(state, white) {
  const out = []
  const pseudo = pseudoMoves(state, white)
  for (const m of pseudo) {
    const u = applyMove(state, m)
    if (!inCheck(state.board, white)) out.push(m)
    undoMove(state, u)
  }
  return out
}

// Evaluation from White's perspective (positive = good for White).
function evaluate(state) {
  const b = state.board
  let score = 0
  let mobW = 0, mobB = 0
  for (let i = 0; i < 64; i++) {
    const p = b[i]
    if (!p) continue
    const sign = p.w ? 1 : -1
    let v = VAL[p.t]
    // PST: read mirrored for White.
    const pstIdx = p.w ? (63 - i) : i
    v += PST[p.t][pstIdx]
    score += sign * v
  }
  // small mobility term
  mobW = pseudoMoves(state, WHITE).length
  mobB = pseudoMoves(state, BLACK).length
  score += (mobW - mobB) * 2
  return score
}

// Negamax with alpha-beta. Returns score from the perspective of `white` to move.
function search(state, depth, alpha, beta, white) {
  const moves = legalMoves(state, white)
  if (moves.length === 0) {
    if (inCheck(state.board, white)) return -100000 - depth // checkmated
    return 0 // stalemate
  }
  if (depth === 0) {
    const e = evaluate(state)
    return white ? e : -e
  }
  // order captures first for better pruning
  moves.sort((a, b) => {
    const ca = state.board[a.to] ? VAL[state.board[a.to].t] : 0
    const cb = state.board[b.to] ? VAL[state.board[b.to].t] : 0
    return cb - ca
  })
  let best = -Infinity
  for (const m of moves) {
    const u = applyMove(state, m)
    const s = -search(state, depth - 1, -beta, -alpha, !white)
    undoMove(state, u)
    if (s > best) best = s
    if (best > alpha) alpha = best
    if (alpha >= beta) break
  }
  return best
}

function aiBestMove(state, depth) {
  const moves = legalMoves(state, BLACK)
  if (moves.length === 0) return null
  moves.sort((a, b) => {
    const ca = state.board[a.to] ? VAL[state.board[a.to].t] : 0
    const cb = state.board[b.to] ? VAL[state.board[b.to].t] : 0
    return cb - ca
  })
  let best = moves[0]
  let bestScore = -Infinity
  let alpha = -Infinity
  const beta = Infinity
  for (const m of moves) {
    const u = applyMove(state, m)
    const s = -search(state, depth - 1, -beta, -alpha, WHITE)
    undoMove(state, u)
    if (s > bestScore) { bestScore = s; best = m }
    if (bestScore > alpha) alpha = bestScore
  }
  return best
}

const BEST_KEY = '10xgames.chess.best'
const AI_DEPTH = 3
const MOVE_CAP = 80 // plies; end + restart the autoplay demo if a game runs too long

export default function Chess() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')

    const auto = isAutoplay('chess')
    let autoTimer = 0       // timer driving White's self-play moves
    let restartTimer = 0    // timer scheduling auto-restart after game over
    let whiteSkill = 'good' // 'good' = use negamax; 'sloppy' = random legal move
    let wantWin = true      // this round: should White (the shown side) win?
    let plyCount = 0        // half-moves played this session (for the move cap)
    let recorded = false    // ensure recordAutoplayResult fires once per session

    let state, turn, phase, result, aiOn, lock
    let selected = null // square index of selected piece
    let legalForSel = [] // legal move objects from selected piece
    let allLegal = []
    let lastMove = null // { from, to }
    let wins = 0
    try { wins = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0 } catch { wins = 0 }
    let aiTimer = 0, raf = 0

    function refreshLegal() {
      allLegal = legalMoves(state, turn === 1 ? WHITE : BLACK)
    }

    function reset() {
      state = initialState()
      turn = 1 // 1 = White/player, 2 = Black/AI
      phase = 'playing'
      result = null
      selected = null
      legalForSel = []
      lastMove = null
      lock = false
      // Autoplay always keeps the Black AI on so the demo actually plays a game.
      if (auto) aiOn = true
      else if (aiOn === undefined) aiOn = true
      plyCount = 0
      recorded = false
      refreshLegal()
      if (auto) {
        // Decide this round's outcome via the shared ~95% controller.
        // WIN round: White plays strong negamax, Black is heavily weakened
        // (random legal moves) so White reliably reaches checkmate.
        // LOSE round (~5%): White plays sloppy/random, Black plays strong → Black mates.
        wantWin = shouldAutoWin('chess')
        whiteSkill = wantWin ? 'good' : 'sloppy'
        scheduleAutoWhite()
      }
    }

    // Choose White's move for the self-play bot from the LEGAL move list.
    function autoWhiteMove() {
      if (!allLegal.length) return null
      if (whiteSkill === 'sloppy') {
        return allLegal[Math.floor(Math.random() * allLegal.length)]
      }
      // 'good': pick the best move via negamax (depth kept low for snappy play).
      let best = allLegal[0]
      let bestScore = -Infinity
      let alpha = -Infinity
      const beta = Infinity
      for (const m of allLegal) {
        const u = applyMove(state, m)
        const s = -search(state, AI_DEPTH - 1, -beta, -alpha, BLACK)
        undoMove(state, u)
        if (s > bestScore) { bestScore = s; best = m }
        if (bestScore > alpha) alpha = bestScore
      }
      return best
    }

    // Drive White on a timer (slow enough that each move is visible).
    function scheduleAutoWhite() {
      if (!auto) return
      if (phase === 'over' || turn !== 1) return
      lock = true
      autoTimer = setTimeout(() => {
        lock = false
        if (phase === 'over' || turn !== 1) return
        const m = autoWhiteMove()
        if (m) {
          applyMove(state, m)
          lastMove = { from: m.from, to: m.to }
          endTurn()
        }
      }, 600 + Math.floor(Math.random() * 300)) // ~600-900ms
    }

    // Finish the autoplay session: record the result once (White checkmate = win)
    // and schedule a fresh game so the demo keeps cycling.
    function finishAutoSession(whiteWon) {
      if (!auto) return
      if (!recorded) { recorded = true; recordAutoplayResult('chess', whiteWon === true) }
      clearTimeout(restartTimer)
      restartTimer = setTimeout(() => { clearTimeout(aiTimer); clearTimeout(autoTimer); lock = false; reset() }, 1800)
    }

    function checkEnd() {
      if (allLegal.length === 0) {
        phase = 'over'
        const sideWhite = turn === 1
        let whiteWon = false
        if (inCheck(state.board, sideWhite)) {
          // side to move is checkmated -> other side wins
          result = turn === 1 ? 2 : 1
          whiteWon = result === 1
          if (aiOn && result === 1) {
            wins += 1
            try { localStorage.setItem(BEST_KEY, String(wins)) } catch {}
          }
        } else {
          result = 0 // stalemate / draw
        }
        // Autoplay: record outcome then loop into a fresh game.
        finishAutoSession(whiteWon)
        return true
      }
      return false
    }

    function endTurn() {
      plyCount += 1
      turn = turn === 1 ? 2 : 1
      selected = null
      legalForSel = []
      refreshLegal()
      // Move cap: a long/drawish autoplay game ends here (not a win) and restarts,
      // so the demo never stalls. Strong White vs random Black usually mates first.
      if (auto && plyCount >= MOVE_CAP && phase !== 'over') {
        phase = 'over'
        result = 0
        finishAutoSession(false)
        return
      }
      if (checkEnd()) return
      if (aiOn && turn === 2) scheduleAI()
      else if (auto && turn === 1) scheduleAutoWhite()
    }

    // Heavily-weakened Black for autoplay WIN rounds: random legal move, but if a
    // capture is available it occasionally takes it (so play looks plausible, not
    // suicidal) — never its search. Only used when (auto && wantWin).
    function autoWeakBlackMove() {
      const moves = legalMoves(state, BLACK)
      if (!moves.length) return null
      const caps = moves.filter((m) => state.board[m.to] || m.ep)
      if (caps.length && Math.random() < 0.3) {
        return caps[Math.floor(Math.random() * caps.length)]
      }
      return moves[Math.floor(Math.random() * moves.length)]
    }

    function scheduleAI() {
      lock = true
      // Autoplay win rounds: weaken Black so White (the shown side) mates it.
      // Human play (or autoplay lose rounds) keeps the normal strong Black AI.
      const weak = auto && wantWin
      aiTimer = setTimeout(() => {
        const m = weak ? autoWeakBlackMove() : aiBestMove(state, AI_DEPTH)
        lock = false
        if (m) {
          applyMove(state, m)
          lastMove = { from: m.from, to: m.to }
          endTurn()
        }
      }, weak ? 600 + Math.floor(Math.random() * 200) : 200)
    }

    function selectPiece(sq) {
      const moves = allLegal.filter((m) => m.from === sq)
      if (!moves.length) { selected = null; legalForSel = []; return }
      selected = sq
      legalForSel = moves
    }

    function tryPlayerAction(sq) {
      if (auto) return // self-play demo: ignore input
      if (phase === 'over' || lock) return
      if (aiOn && turn !== 1) return
      if (selected !== null) {
        const m = legalForSel.find((mm) => mm.to === sq)
        if (m) {
          applyMove(state, m)
          lastMove = { from: m.from, to: m.to }
          endTurn()
          return
        }
      }
      const p = state.board[sq]
      const sideWhite = turn === 1
      if (p && p.w === sideWhite) selectPiece(sq)
      else { selected = null; legalForSel = [] }
    }

    // ---------- input ----------
    function cellFromEvent(e) {
      const rect = canvas.getBoundingClientRect()
      const scale = W / rect.width
      const x = (e.clientX - rect.left) * scale - BOARD_X
      const y = (e.clientY - rect.top) * scale - BOARD_Y
      if (x < 0 || x >= BOARD || y < 0 || y >= BOARD) return null
      return idx(Math.floor(y / CELL), Math.floor(x / CELL))
    }
    function onPointer(e) {
      e.preventDefault()
      if (auto) return // self-play demo drives itself; ignore taps
      if (phase === 'over') { reset(); return }
      const sq = cellFromEvent(e)
      if (sq === null) return
      tryPlayerAction(sq)
    }
    function onKey(e) {
      if (auto) return // self-play demo: ignore keys
      if (e.code === 'KeyR') { e.preventDefault(); clearTimeout(aiTimer); lock = false; reset() }
      else if (e.code === 'KeyA') {
        if (!e.repeat) { aiOn = !aiOn; clearTimeout(aiTimer); lock = false; reset() }
      } else if (e.code === 'Space') { e.preventDefault(); if (phase === 'over') reset() }
    }
    canvas.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)

    // ---------- drawing ----------
    const sqX = (c) => BOARD_X + c * CELL
    const sqY = (r) => BOARD_Y + r * CELL

    function sparkle(x, y, s) {
      ctx.strokeStyle = PINK; ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(x - s, y); ctx.lineTo(x + s, y)
      ctx.moveTo(x, y - s); ctx.lineTo(x, y + s)
      ctx.stroke()
    }

    function drawPiece(sq, p) {
      const r = Math.floor(sq / 8), c = sq % 8
      const cx = sqX(c) + CELL / 2, cy = sqY(r) + CELL / 2
      const color = p.w ? WHITE_PC : CYAN
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = '40px "Segoe UI Symbol", "Arial Unicode MS", system-ui, sans-serif'
      ctx.shadowColor = color
      ctx.shadowBlur = p.w ? 10 : 14
      ctx.fillStyle = color
      ctx.fillText(GLYPH[p.t], cx, cy + 2)
      ctx.shadowBlur = 0
    }

    function draw() {
      ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, W, H)
      sparkle(W - 18, 20, 5); sparkle(18, H - 20, 4)

      // status
      let status, color = '#fff'
      const whiteToMove = turn === 1
      const checked = phase === 'playing' && inCheck(state.board, whiteToMove)
      if (phase === 'over') {
        if (result === 0) { status = 'STALEMATE'; color = '#8a93ad' }
        else if (aiOn) { status = result === 1 ? 'CHECKMATE — YOU WIN' : 'CHECKMATE — CPU WINS'; color = result === 1 ? PINK : CYAN }
        else { status = (result === 1 ? 'WHITE' : 'BLACK') + ' WINS'; color = result === 1 ? WHITE_PC : CYAN }
      } else if (checked) {
        status = 'CHECK'; color = PINK
      } else if (aiOn) {
        status = turn === 1 ? 'YOUR MOVE' : 'CPU THINKING…'; color = turn === 1 ? WHITE_PC : CYAN
      } else {
        status = (turn === 1 ? 'WHITE' : 'BLACK') + ' TO MOVE'; color = turn === 1 ? WHITE_PC : CYAN
      }
      ctx.textAlign = 'center'
      ctx.textBaseline = 'alphabetic'
      ctx.fillStyle = color; ctx.font = '800 24px system-ui, sans-serif'
      ctx.fillText(status, W / 2, PAD + 24)
      const tw = ctx.measureText(status).width
      ctx.fillStyle = PINK; ctx.fillRect(W / 2 - tw / 2, PAD + 32, tw, 3)
      ctx.font = '600 12px system-ui, sans-serif'; ctx.fillStyle = '#8a93ad'
      const sub = aiOn ? `WINS VS CPU  ·  ${wins}` : 'TWO-PLAYER'
      ctx.fillText(sub, W / 2, PAD + 50)

      // board frame
      ctx.strokeStyle = 'rgba(255,45,111,0.45)'; ctx.lineWidth = 2
      ctx.strokeRect(BOARD_X - 2, BOARD_Y - 2, BOARD + 4, BOARD + 4)

      // squares
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          ctx.fillStyle = (r + c) % 2 === 0 ? DARK_SQ : LIGHT_SQ
          ctx.fillRect(sqX(c), sqY(r), CELL, CELL)
        }
      }

      // last move highlight
      if (lastMove) {
        for (const s of [lastMove.from, lastMove.to]) {
          const r = Math.floor(s / 8), c = s % 8
          ctx.fillStyle = 'rgba(45,226,230,0.16)'
          ctx.fillRect(sqX(c), sqY(r), CELL, CELL)
        }
      }

      // selected highlight
      if (selected !== null) {
        const r = Math.floor(selected / 8), c = selected % 8
        ctx.fillStyle = 'rgba(255,45,111,0.22)'
        ctx.fillRect(sqX(c), sqY(r), CELL, CELL)
        ctx.strokeStyle = PINK; ctx.lineWidth = 2
        ctx.strokeRect(sqX(c) + 2, sqY(r) + 2, CELL - 4, CELL - 4)
      }

      // legal targets
      for (const m of legalForSel) {
        const r = Math.floor(m.to / 8), c = m.to % 8
        const cx = sqX(c) + CELL / 2, cy = sqY(r) + CELL / 2
        const isCap = !!state.board[m.to] || m.ep
        ctx.beginPath()
        if (isCap) {
          ctx.arc(cx, cy, CELL / 2 - 4, 0, Math.PI * 2)
          ctx.strokeStyle = 'rgba(255,214,10,0.9)'; ctx.lineWidth = 3
          ctx.shadowColor = '#ffd60a'; ctx.shadowBlur = 8
          ctx.stroke(); ctx.shadowBlur = 0
        } else {
          ctx.arc(cx, cy, 8, 0, Math.PI * 2)
          ctx.fillStyle = 'rgba(45,226,230,0.85)'
          ctx.shadowColor = CYAN; ctx.shadowBlur = 10
          ctx.fill(); ctx.shadowBlur = 0
        }
      }

      // king-in-check glow
      if (checked) {
        const k = findKing(state.board, whiteToMove)
        const r = Math.floor(k / 8), c = k % 8
        ctx.strokeStyle = PINK; ctx.lineWidth = 3
        ctx.shadowColor = PINK; ctx.shadowBlur = 14
        ctx.strokeRect(sqX(c) + 2, sqY(r) + 2, CELL - 4, CELL - 4)
        ctx.shadowBlur = 0
      }

      // pieces
      for (let i = 0; i < 64; i++) {
        const p = state.board[i]
        if (p) drawPiece(i, p)
      }

      // hint line
      ctx.fillStyle = '#8a93ad'; ctx.font = '600 11px system-ui, sans-serif'
      ctx.textAlign = 'center'
      const overHint = 'tap / space to play again'
      const playHint = 'click piece then target · R restart · A: ' + (aiOn ? 'switch to 2-player' : 'vs CPU')
      ctx.fillText(phase === 'over' ? overHint : playHint, W / 2, H - 6)
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
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  return (
    <canvas ref={canvasRef} width={W} height={H} className="chess-canvas" aria-label="Chess game" />
  )
}
