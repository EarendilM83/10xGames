import { useEffect, useRef } from 'react'
import { isAutoplay, shouldAutoWin, recordAutoplayResult } from '../autoplay.js'

// Classic Tetris on canvas, styled in the 10x brand language (neon-on-black, pink accents).
const COLS = 10
const ROWS = 20
const CELL = 28
const PAD = 18
const SIDE = 140
const PLAY_W = COLS * CELL
const PLAY_H = ROWS * CELL
const W = PAD + PLAY_W + 18 + SIDE + PAD
const H = PAD + PLAY_H + PAD
const PLAY_X = PAD
const PLAY_Y = PAD

const PINK = '#ff2d6f'

const COLORS = {
  I: '#2de2e6', O: '#ffd60a', T: '#b14aed',
  S: '#54e346', Z: '#ff2d6f', J: '#4d7cff', L: '#ff8a1e',
}

const SHAPES = {
  I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
  O: [[1, 1], [1, 1]],
  T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
  S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
  Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
  J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
  L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
}
const KEYS = ['I', 'O', 'T', 'S', 'Z', 'J', 'L']
const LINE_SCORES = [0, 100, 300, 500, 800]
const KICKS = [[0, 0], [-1, 0], [1, 0], [0, -1], [-2, 0], [2, 0], [0, 1]] // [dCol, dRow]
const HS_KEY = '10xgames.tetris.best'

export default function Tetris() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const auto = isAutoplay('tetris')

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')

    let board = []        // ROWS x COLS, null or color
    let piece = null      // { key, m, r, c }
    let nextKey = null
    let bag = []
    let score = 0, lines = 0, level = 1
    let best = Number(localStorage.getItem(HS_KEY)) || 0
    let state = 'playing' // playing | paused | over
    let acc = 0, last = performance.now()
    let raf = 0

    // ---------- autoplay round state ----------
    let wantWin = true, restartAt = 0
    let plan = null       // { rot, col } target for the current piece
    let planned = false   // whether a plan was computed for the live piece
    let recorded = false  // game-over result logged once per round

    const dropInterval = () => Math.max(70, 800 - (level - 1) * 65)

    function reset() {
      board = Array.from({ length: ROWS }, () => new Array(COLS).fill(null))
      score = 0; lines = 0; level = 1; state = 'playing'
      bag = []; nextKey = drawFromBag()
      spawn()
    }

    function drawFromBag() {
      if (bag.length === 0) {
        bag = [...KEYS]
        for (let i = bag.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));[bag[i], bag[j]] = [bag[j], bag[i]]
        }
      }
      return bag.pop()
    }

    function spawn() {
      const key = nextKey
      nextKey = drawFromBag()
      const m = SHAPES[key].map((row) => [...row])
      const c = Math.floor((COLS - m[0].length) / 2)
      piece = { key, m, r: 0, c }
      plan = null; planned = false // bot replans for the freshly spawned piece
      if (collide(m, 0, c)) state = 'over' // top-out
    }

    function collide(m, pr, pc) {
      for (let r = 0; r < m.length; r++) for (let c = 0; c < m[r].length; c++) {
        if (!m[r][c]) continue
        const br = pr + r, bc = pc + c
        if (bc < 0 || bc >= COLS || br >= ROWS) return true
        if (br >= 0 && board[br][bc]) return true
      }
      return false
    }

    function rotate(dir) {
      const m = piece.m
      const n = m.length
      const out = Array.from({ length: n }, () => new Array(n).fill(0))
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
        if (dir > 0) out[c][n - 1 - r] = m[r][c]
        else out[n - 1 - c][r] = m[r][c]
      }
      for (const [dc, dr] of KICKS) {
        if (!collide(out, piece.r + dr, piece.c + dc)) {
          piece.m = out; piece.r += dr; piece.c += dc; return
        }
      }
    }

    function move(dc) {
      if (!collide(piece.m, piece.r, piece.c + dc)) piece.c += dc
    }

    function softDrop() {
      if (!collide(piece.m, piece.r + 1, piece.c)) { piece.r += 1; score += 1 }
      else lock()
    }

    function hardDrop() {
      let d = 0
      while (!collide(piece.m, piece.r + 1, piece.c)) { piece.r += 1; d++ }
      score += d * 2
      lock()
    }

    function lock() {
      const m = piece.m
      for (let r = 0; r < m.length; r++) for (let c = 0; c < m[r].length; c++) {
        if (m[r][c] && piece.r + r >= 0) board[piece.r + r][piece.c + c] = COLORS[piece.key]
      }
      clearLines()
      spawn()
    }

    function clearLines() {
      let cleared = 0
      for (let r = ROWS - 1; r >= 0; r--) {
        if (board[r].every((cell) => cell)) {
          board.splice(r, 1)
          board.unshift(new Array(COLS).fill(null))
          cleared++; r++ // recheck same index
        }
      }
      if (cleared > 0) {
        lines += cleared
        score += LINE_SCORES[cleared] * level
        level = Math.floor(lines / 10) + 1
        if (score > best) { best = score; localStorage.setItem(HS_KEY, String(best)) }
      }
    }

    function ghostRow() {
      let r = piece.r
      while (!collide(piece.m, r + 1, piece.c)) r++
      return r
    }

    // ---------- autoplay bot ----------
    // Rotate a piece matrix clockwise `times`, trimmed to its tight bounds so we can
    // simulate it freely across columns without the in-game kick logic.
    function rotatedMatrix(key, times) {
      let m = SHAPES[key].map((row) => [...row])
      for (let t = 0; t < ((times % 4) + 4) % 4; t++) {
        const n = m.length
        const out = Array.from({ length: n }, () => new Array(n).fill(0))
        for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) out[c][n - 1 - r] = m[r][c]
        m = out
      }
      return m
    }

    // Drop a matrix at column `col` onto a copy of `board`; returns metrics or null if invalid.
    function evaluate(m, col) {
      const cells = []
      for (let r = 0; r < m.length; r++) for (let c = 0; c < m[r].length; c++) if (m[r][c]) cells.push([r, c])
      // must fit horizontally
      for (const [, c] of cells) { const bc = col + c; if (bc < 0 || bc >= COLS) return null }
      // find resting row (lowest pr where no collision, pr+1 collides)
      const fits = (pr) => {
        for (const [r, c] of cells) {
          const br = pr + r, bc = col + c
          if (br >= ROWS) return false
          if (br >= 0 && board[br][bc]) return false
        }
        return true
      }
      let pr = -m.length
      if (!fits(pr)) return null
      while (fits(pr + 1)) pr++
      // build resulting grid (heights of stack)
      const grid = board.map((row) => row.slice())
      for (const [r, c] of cells) { const br = pr + r; if (br >= 0) grid[br][col + c] = true }
      // count cleared lines
      let cleared = 0
      for (let r = 0; r < ROWS; r++) if (grid[r].every((cell) => cell)) cleared++
      // column heights + holes
      let agg = 0, holes = 0, bump = 0
      const heights = new Array(COLS).fill(0)
      for (let c = 0; c < COLS; c++) {
        let seen = false
        for (let r = 0; r < ROWS; r++) {
          if (grid[r][c]) { if (!seen) { heights[c] = ROWS - r; seen = true } }
          else if (seen) holes++
        }
        agg += heights[c]
      }
      for (let c = 0; c < COLS - 1; c++) bump += Math.abs(heights[c] - heights[c + 1])
      return { agg, holes, bump, cleared, score: -0.51 * agg + 0.76 * cleared - 0.36 * holes - 0.18 * bump }
    }

    // Pick the target rotation+column for the live piece.
    function computePlan() {
      const key = piece.key
      const placements = []
      for (let rot = 0; rot < 4; rot++) {
        const m = rotatedMatrix(key, rot)
        for (let col = -2; col < COLS; col++) {
          const e = evaluate(m, col)
          if (e) placements.push({ rot, col, ...e })
        }
      }
      if (placements.length === 0) return { rot: 0, col: piece.c }
      if (wantWin) {
        placements.sort((a, b) => b.score - a.score)
        return { rot: placements[0].rot, col: placements[0].col }
      }
      // sloppy: build the tallest, hole-riddled stack possible and never clear lines,
      // so the round tops out well before 8 lines. Heaviest penalty = worst board.
      const ruin = (p) => p.agg + p.holes * 4 - p.cleared * 100
      placements.sort((a, b) => ruin(b) - ruin(a))
      const pool = placements.slice(0, Math.max(1, Math.ceil(placements.length * 0.2)))
      const pick = pool[Math.floor(Math.random() * pool.length)]
      return { rot: pick.rot, col: pick.col }
    }

    // Advance the bot one micro-step: rotate toward target, then shift, then hard drop.
    function botStep() {
      if (!piece) return
      if (!planned) { plan = computePlan(); planned = true }
      if (!plan) return
      // rotate until matrix matches the planned rotation (compare against fresh rotation count)
      const target = rotatedMatrix(piece.key, plan.rot)
      if (JSON.stringify(trim(piece.m)) !== JSON.stringify(trim(target))) { rotate(1); return }
      // shift toward the planned column (column offset of the trimmed shape)
      const cur = piece.c + leftPad(piece.m)
      const want = plan.col + leftPad(target)
      if (cur < want) { move(1); return }
      if (cur > want) { move(-1); return }
      hardDrop()
    }

    // Tight-bounds helpers so trimmed matrices compare equal regardless of padding.
    function trim(m) {
      const cells = []
      for (let r = 0; r < m.length; r++) for (let c = 0; c < m[r].length; c++) if (m[r][c]) cells.push([r, c])
      if (cells.length === 0) return [[0]]
      const minR = Math.min(...cells.map((p) => p[0])), maxR = Math.max(...cells.map((p) => p[0]))
      const minC = Math.min(...cells.map((p) => p[1])), maxC = Math.max(...cells.map((p) => p[1]))
      const out = []
      for (let r = minR; r <= maxR; r++) { const row = []; for (let c = minC; c <= maxC; c++) row.push(m[r][c] ? 1 : 0); out.push(row) }
      return out
    }
    function leftPad(m) {
      let min = m[0].length
      for (let r = 0; r < m.length; r++) for (let c = 0; c < m[r].length; c++) if (m[r][c]) min = Math.min(min, c)
      return min
    }

    // ---------- input ----------
    function onKey(e) {
      if (auto) return
      if (state === 'over') {
        if (['Space', 'Enter', 'KeyR'].includes(e.code)) { e.preventDefault(); reset() }
        return
      }
      if (e.code === 'KeyP') { if (!e.repeat) state = state === 'paused' ? 'playing' : 'paused'; return }
      if (state === 'paused') return
      switch (e.code) {
        case 'ArrowLeft': e.preventDefault(); move(-1); break
        case 'ArrowRight': e.preventDefault(); move(1); break
        case 'ArrowDown': e.preventDefault(); softDrop(); break
        case 'ArrowUp': case 'KeyX': if (!e.repeat) { e.preventDefault(); rotate(1) } break
        case 'KeyZ': if (!e.repeat) { e.preventDefault(); rotate(-1) } break
        case 'Space': if (!e.repeat) { e.preventDefault(); hardDrop() } break
        default: break
      }
    }
    function onPointer() { if (auto) return; if (state === 'over') reset() }
    window.addEventListener('keydown', onKey)
    canvas.addEventListener('pointerdown', onPointer)

    // ---------- drawing ----------
    function block(x, y, color, size = CELL, alpha = 1) {
      ctx.globalAlpha = alpha
      ctx.fillStyle = color
      ctx.fillRect(x + 1, y + 1, size - 2, size - 2)
      // glossy top-left highlight
      ctx.fillStyle = 'rgba(255,255,255,0.28)'
      ctx.fillRect(x + 1, y + 1, size - 2, 4)
      ctx.fillRect(x + 1, y + 1, 4, size - 2)
      // dark bottom-right
      ctx.fillStyle = 'rgba(0,0,0,0.30)'
      ctx.fillRect(x + 1, y + size - 5, size - 2, 4)
      ctx.fillRect(x + size - 5, y + 1, 4, size - 2)
      ctx.globalAlpha = 1
    }

    function sparkle(x, y, s) {
      ctx.strokeStyle = PINK; ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(x - s, y); ctx.lineTo(x + s, y); ctx.moveTo(x, y - s); ctx.lineTo(x, y + s); ctx.stroke()
    }

    function label(text, x, y) {
      ctx.fillStyle = PINK; ctx.font = '700 12px system-ui, sans-serif'; ctx.textAlign = 'left'
      ctx.fillText(text, x, y)
      ctx.fillStyle = PINK; ctx.fillRect(x, y + 5, 22, 3) // pink underline bar
    }
    function value(text, x, y) {
      ctx.fillStyle = '#fff'; ctx.font = '800 26px system-ui, sans-serif'; ctx.textAlign = 'left'
      ctx.fillText(text, x, y)
    }

    function draw() {
      // background
      ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, W, H)
      sparkle(W - 30, 24, 5); sparkle(W - 80, H - 30, 4); sparkle(PLAY_X + PLAY_W + 40, 200, 4)

      // playfield bg + grid
      ctx.fillStyle = '#101016'
      ctx.fillRect(PLAY_X, PLAY_Y, PLAY_W, PLAY_H)
      ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1
      for (let c = 1; c < COLS; c++) { ctx.beginPath(); ctx.moveTo(PLAY_X + c * CELL, PLAY_Y); ctx.lineTo(PLAY_X + c * CELL, PLAY_Y + PLAY_H); ctx.stroke() }
      for (let r = 1; r < ROWS; r++) { ctx.beginPath(); ctx.moveTo(PLAY_X, PLAY_Y + r * CELL); ctx.lineTo(PLAY_X + PLAY_W, PLAY_Y + r * CELL); ctx.stroke() }

      // settled blocks
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        if (board[r][c]) block(PLAY_X + c * CELL, PLAY_Y + r * CELL, board[r][c])
      }

      // ghost + active piece
      if (piece && state !== 'over') {
        const gr = ghostRow()
        const m = piece.m
        for (let r = 0; r < m.length; r++) for (let c = 0; c < m[r].length; c++) {
          if (!m[r][c]) continue
          if (gr + r >= 0) block(PLAY_X + (piece.c + c) * CELL, PLAY_Y + (gr + r) * CELL, COLORS[piece.key], CELL, 0.18)
        }
        for (let r = 0; r < m.length; r++) for (let c = 0; c < m[r].length; c++) {
          if (m[r][c] && piece.r + r >= 0) block(PLAY_X + (piece.c + c) * CELL, PLAY_Y + (piece.r + r) * CELL, COLORS[piece.key])
        }
      }

      // playfield frame (pink)
      ctx.strokeStyle = PINK; ctx.lineWidth = 2; ctx.strokeRect(PLAY_X - 1, PLAY_Y - 1, PLAY_W + 2, PLAY_H + 2)

      // sidebar
      const sx = PLAY_X + PLAY_W + 18
      label('NEXT', sx, PLAY_Y + 14)
      // next preview box
      const boxY = PLAY_Y + 26, boxH = 92
      ctx.fillStyle = '#101016'; ctx.fillRect(sx, boxY, SIDE, boxH)
      ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.strokeRect(sx + 0.5, boxY + 0.5, SIDE - 1, boxH - 1)
      if (nextKey) {
        const nm = SHAPES[nextKey]
        const cells = []
        for (let r = 0; r < nm.length; r++) for (let c = 0; c < nm[r].length; c++) if (nm[r][c]) cells.push([r, c])
        const minC = Math.min(...cells.map((p) => p[1])), maxC = Math.max(...cells.map((p) => p[1]))
        const minR = Math.min(...cells.map((p) => p[0])), maxR = Math.max(...cells.map((p) => p[0]))
        const pw = (maxC - minC + 1) * 22, ph = (maxR - minR + 1) * 22
        const ox = sx + (SIDE - pw) / 2, oy = boxY + (boxH - ph) / 2
        for (const [r, c] of cells) block(ox + (c - minC) * 22, oy + (r - minR) * 22, COLORS[nextKey], 22)
      }

      label('SCORE', sx, boxY + boxH + 36); value(String(score), sx, boxY + boxH + 66)
      label('LINES', sx, boxY + boxH + 104); value(String(lines), sx, boxY + boxH + 134)
      label('LEVEL', sx, boxY + boxH + 172); value(String(level), sx, boxY + boxH + 202)
      ctx.fillStyle = '#8a93ad'; ctx.font = '600 11px system-ui, sans-serif'
      ctx.fillText('BEST  ' + best, sx, boxY + boxH + 230)

      // overlays
      if (state === 'paused') overlay('PAUSED', 'press P to resume')
      if (state === 'over') overlay('GAME OVER', 'tap / space to play again')
    }

    function overlay(title, sub) {
      ctx.fillStyle = 'rgba(10,10,10,0.82)'; ctx.fillRect(PLAY_X, PLAY_Y, PLAY_W, PLAY_H)
      ctx.textAlign = 'center'
      ctx.fillStyle = PINK; ctx.font = '800 34px system-ui, sans-serif'
      ctx.fillText(title, PLAY_X + PLAY_W / 2, PLAY_Y + PLAY_H / 2 - 6)
      ctx.fillStyle = PINK; ctx.fillRect(PLAY_X + PLAY_W / 2 - 60, PLAY_Y + PLAY_H / 2 + 6, 120, 4)
      ctx.fillStyle = '#fff'; ctx.font = '600 14px system-ui, sans-serif'
      ctx.fillText(sub, PLAY_X + PLAY_W / 2, PLAY_Y + PLAY_H / 2 + 36)
    }

    function newRound() {
      reset()
      wantWin = shouldAutoWin('tetris')
      recorded = false
    }

    let botAcc = 0
    const BOT_STEP = 45 // ms between bot micro-moves (rotate / shift / drop)
    const WIN_LINES = 10 // winning rounds end here (>= 8 line win, kept watchable)

    function loop(now) {
      const dt = now - last; last = now
      if (auto && state === 'over') {
        if (!recorded) { recorded = true; recordAutoplayResult('tetris', lines >= 8) }
        if (!restartAt) restartAt = now + 1300
        else if (now >= restartAt) { restartAt = 0; newRound() }
      }
      if (state === 'playing') {
        if (auto) {
          // A winning round only needs >= 8 lines: once it has a safe margin, end the
          // round cleanly so it records the win and restarts instead of playing forever.
          if (wantWin && lines >= WIN_LINES) { state = 'over' }
          botAcc += dt
          while (botAcc >= BOT_STEP && state === 'playing') { botAcc -= BOT_STEP; botStep() }
        } else {
          acc += dt
          if (acc >= dropInterval()) { acc = 0; softDrop() }
        }
      }
      draw()
      raf = requestAnimationFrame(loop)
    }

    if (auto) newRound(); else reset()
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKey)
      canvas.removeEventListener('pointerdown', onPointer)
    }
  }, [])

  return (
    <canvas ref={canvasRef} width={W} height={H} className="tetris-canvas" aria-label="Tetris game" />
  )
}
