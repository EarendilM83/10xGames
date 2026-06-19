import { useEffect, useRef } from 'react'
import { isAutoplay, shouldAutoWin, recordAutoplayResult } from '../autoplay.js'

// Self-contained neon Sudoku on canvas, with a built-in autoplay bot.
// Unique-solution puzzles: fill a full grid by randomized backtracking, then carve
// cells away while a counting solver (capped at 2 solutions) confirms uniqueness.
const N = 9
const CELL = 50
const BOARD = N * CELL              // 450
const MARGIN = 16
const BOARD_X = MARGIN
const HEADER_H = 70
const BOARD_Y = HEADER_H
const GAP = 18
const PAD_Y = BOARD_Y + BOARD + GAP
const PAD_CELL = 44
const PAD_GAP = 4
const PAD_W = N * PAD_CELL + (N - 1) * PAD_GAP   // 9*44 + 8*4 = 428
const PAD_X = (BOARD + MARGIN * 2 - PAD_W) / 2
const BTN_Y = PAD_Y + PAD_CELL + GAP
const BTN_H = 40

const W = BOARD + MARGIN * 2        // 482
const H = BTN_Y + BTN_H + MARGIN    // header + board + pad + buttons

// 10x neon palette
const BG = '#0a0a0a'
const PINK = '#ff2d6f'
const CYAN = '#2de2e6'
const GIVEN = '#ffffff'
const CONFLICT = '#ff2d6f'
const PANEL = '#101018'

const HS_KEY = '10xgames.sudoku.best'
const GIVENS = 38 // number of clues kept; rest carved out (must remain unique)

export default function Sudoku() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const auto = isAutoplay('sudoku')

    // ---------- solver / generator helpers ----------
    function deepCopy(g) { return g.map((r) => r.slice()) }

    function canPlace(g, r, c, v) {
      for (let i = 0; i < N; i++) {
        if (g[r][i] === v || g[i][c] === v) return false
      }
      const br = Math.floor(r / 3) * 3, bc = Math.floor(c / 3) * 3
      for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) {
        if (g[br + dr][bc + dc] === v) return false
      }
      return true
    }

    function shuffled(arr) {
      const a = arr.slice()
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[a[i], a[j]] = [a[j], a[i]]
      }
      return a
    }

    // Fill a full valid grid via randomized backtracking.
    function fillFull(g) {
      for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
          if (g[r][c] !== 0) continue
          for (const v of shuffled([1, 2, 3, 4, 5, 6, 7, 8, 9])) {
            if (canPlace(g, r, c, v)) {
              g[r][c] = v
              if (fillFull(g)) return true
              g[r][c] = 0
            }
          }
          return false
        }
      }
      return true
    }

    // Count solutions, stopping at `cap` (we only ever need to know "exactly 1").
    function countSolutions(g, cap) {
      let count = 0
      function rec() {
        let br = -1, bc = -1
        for (let r = 0; r < N && br < 0; r++) {
          for (let c = 0; c < N; c++) {
            if (g[r][c] === 0) { br = r; bc = c; break }
          }
        }
        if (br < 0) { count++; return }
        for (let v = 1; v <= 9; v++) {
          if (canPlace(g, br, bc, v)) {
            g[br][bc] = v
            rec()
            g[br][bc] = 0
            if (count >= cap) return
          }
        }
      }
      rec()
      return count
    }

    // Backtracking solver — returns a solved copy (used by the bot to know answers).
    function solveGrid(src) {
      const g = deepCopy(src)
      function rec() {
        for (let r = 0; r < N; r++) {
          for (let c = 0; c < N; c++) {
            if (g[r][c] === 0) {
              for (let v = 1; v <= 9; v++) {
                if (canPlace(g, r, c, v)) {
                  g[r][c] = v
                  if (rec()) return true
                  g[r][c] = 0
                }
              }
              return false
            }
          }
        }
        return true
      }
      return rec() ? g : null
    }

    // Generate a puzzle: full solution + carved board with a UNIQUE solution.
    function generate() {
      const full = Array.from({ length: N }, () => new Array(N).fill(0))
      fillFull(full)
      const solution = deepCopy(full)
      const puzzle = deepCopy(full)
      // Carve cells in random order, keeping uniqueness, until we hit the clue target.
      const cells = shuffled(Array.from({ length: N * N }, (_, i) => i))
      let clues = N * N
      for (const idx of cells) {
        if (clues <= GIVENS) break
        const r = Math.floor(idx / N), c = idx % N
        if (puzzle[r][c] === 0) continue
        const backup = puzzle[r][c]
        puzzle[r][c] = 0
        const test = deepCopy(puzzle)
        if (countSolutions(test, 2) !== 1) {
          puzzle[r][c] = backup // removing it breaks uniqueness — keep the clue
        } else {
          clues--
        }
      }
      return { puzzle, solution }
    }

    // ---------- game state ----------
    let board = []       // current values (0 = empty)
    let given = []       // boolean: locked clue cells
    let solution = []
    let sel = { r: -1, c: -1 }
    let state = 'playing' // playing | won
    let startTime = 0
    let elapsed = 0
    let best = Number(localStorage.getItem(HS_KEY)) || 0
    let raf = 0
    let botTimer = 0

    function newGame() {
      const { puzzle, solution: sol } = generate()
      board = deepCopy(puzzle)
      solution = sol
      given = puzzle.map((row) => row.map((v) => v !== 0))
      sel = { r: -1, c: -1 }
      state = 'playing'
      startTime = performance.now()
      elapsed = 0
    }

    // ---------- rules / conflicts ----------
    // A cell conflicts if a filled peer (row/col/box) holds the same value.
    function isConflict(r, c) {
      const v = board[r][c]
      if (v === 0) return false
      for (let i = 0; i < N; i++) {
        if (i !== c && board[r][i] === v) return true
        if (i !== r && board[i][c] === v) return true
      }
      const br = Math.floor(r / 3) * 3, bc = Math.floor(c / 3) * 3
      for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) {
        const rr = br + dr, cc = bc + dc
        if ((rr !== r || cc !== c) && board[rr][cc] === v) return true
      }
      return false
    }

    function checkWin() {
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
        if (board[r][c] === 0 || board[r][c] !== solution[r][c]) return
      }
      state = 'won'
      const secs = elapsed
      if (best === 0 || secs < best) { best = secs; localStorage.setItem(HS_KEY, String(best)) }
    }

    function place(v) {
      if (state !== 'playing') return
      const { r, c } = sel
      if (r < 0 || given[r][c]) return
      board[r][c] = v
      checkWin()
    }

    function erase() {
      if (state !== 'playing') return
      const { r, c } = sel
      if (r < 0 || given[r][c]) return
      board[r][c] = 0
    }

    // ---------- input ----------
    function pos(e) {
      const rect = canvas.getBoundingClientRect()
      const x = (e.clientX - rect.left) * (W / rect.width)
      const y = (e.clientY - rect.top) * (H / rect.height)
      return { x, y }
    }

    function onDown(e) {
      e.preventDefault()
      const { x, y } = pos(e)
      // New game button (left), Erase button (right)
      const half = (BOARD - GAP) / 2
      const newX = BOARD_X, eraseX = BOARD_X + half + GAP
      if (y >= BTN_Y && y <= BTN_Y + BTN_H) {
        if (x >= newX && x <= newX + half) { newGame(); return }
        if (x >= eraseX && x <= eraseX + half) { erase(); return }
      }
      // Number pad
      if (y >= PAD_Y && y <= PAD_Y + PAD_CELL && x >= PAD_X) {
        const idx = Math.floor((x - PAD_X) / (PAD_CELL + PAD_GAP))
        if (idx >= 0 && idx < N) {
          const cellX = PAD_X + idx * (PAD_CELL + PAD_GAP)
          if (x <= cellX + PAD_CELL) { place(idx + 1); return }
        }
      }
      // Board cell select
      if (x >= BOARD_X && x < BOARD_X + BOARD && y >= BOARD_Y && y < BOARD_Y + BOARD) {
        const c = Math.floor((x - BOARD_X) / CELL)
        const r = Math.floor((y - BOARD_Y) / CELL)
        sel = { r, c }
      }
    }

    function onKey(e) {
      if (e.key >= '1' && e.key <= '9') { place(Number(e.key)); return }
      if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') { erase(); return }
      if (e.key === 'n' || e.key === 'N') { newGame(); return }
      // arrow navigation
      if (sel.r < 0) return
      if (e.key === 'ArrowUp') { sel = { r: Math.max(0, sel.r - 1), c: sel.c }; e.preventDefault() }
      else if (e.key === 'ArrowDown') { sel = { r: Math.min(N - 1, sel.r + 1), c: sel.c }; e.preventDefault() }
      else if (e.key === 'ArrowLeft') { sel = { r: sel.r, c: Math.max(0, sel.c - 1) }; e.preventDefault() }
      else if (e.key === 'ArrowRight') { sel = { r: sel.r, c: Math.min(N - 1, sel.c + 1) }; e.preventDefault() }
    }

    canvas.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)

    // ---------- drawing ----------
    function neonLabel(text, x, y) {
      ctx.save()
      ctx.font = '800 13px system-ui, sans-serif'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
      ctx.fillStyle = PINK
      ctx.shadowColor = PINK
      ctx.shadowBlur = 8
      const up = text.toUpperCase()
      ctx.fillText(up, x, y)
      const w = ctx.measureText(up).width
      ctx.shadowBlur = 0
      ctx.fillRect(x, y + 4, w, 2) // underline bar
      ctx.restore()
    }

    function sparkle(cx, cy, s) {
      ctx.save()
      ctx.strokeStyle = PINK
      ctx.shadowColor = PINK
      ctx.shadowBlur = 6
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(cx - s, cy); ctx.lineTo(cx + s, cy)
      ctx.moveTo(cx, cy - s); ctx.lineTo(cx, cy + s)
      ctx.stroke()
      ctx.restore()
    }

    function fmtTime(secs) {
      const m = Math.floor(secs / 60)
      const s = Math.floor(secs % 60)
      return `${m}:${String(s).padStart(2, '0')}`
    }

    function drawHeader() {
      neonLabel('Sudoku', MARGIN, 26)
      // sparkle corners around the title block
      sparkle(W - MARGIN - 6, 14, 5)
      sparkle(W - MARGIN - 26, 22, 4)
      // time + best
      ctx.font = '800 12px system-ui, sans-serif'
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = CYAN
      ctx.shadowColor = CYAN
      ctx.shadowBlur = 6
      ctx.fillText(fmtTime(elapsed), W - MARGIN, 48)
      ctx.shadowBlur = 0
      ctx.fillStyle = '#8a93ad'
      ctx.font = '700 10px system-ui, sans-serif'
      ctx.fillText(best > 0 ? `BEST ${fmtTime(best)}` : 'BEST --:--', W - MARGIN, 62)
      ctx.textAlign = 'left'
    }

    function drawBoard() {
      // panel background
      ctx.fillStyle = PANEL
      ctx.fillRect(BOARD_X, BOARD_Y, BOARD, BOARD)

      // selected cell + row/col/box highlight
      if (sel.r >= 0) {
        const br = Math.floor(sel.r / 3) * 3, bc = Math.floor(sel.c / 3) * 3
        ctx.fillStyle = 'rgba(45,226,230,0.06)'
        ctx.fillRect(BOARD_X, BOARD_Y + sel.r * CELL, BOARD, CELL)
        ctx.fillRect(BOARD_X + sel.c * CELL, BOARD_Y, CELL, BOARD)
        ctx.fillRect(BOARD_X + bc * CELL, BOARD_Y + br * CELL, CELL * 3, CELL * 3)
        // selected cell glow
        const sx = BOARD_X + sel.c * CELL, sy = BOARD_Y + sel.r * CELL
        ctx.save()
        ctx.fillStyle = 'rgba(45,226,230,0.14)'
        ctx.shadowColor = CYAN
        ctx.shadowBlur = 16
        ctx.fillRect(sx + 1, sy + 1, CELL - 2, CELL - 2)
        ctx.restore()
      }

      // thin grid lines
      ctx.strokeStyle = 'rgba(255,45,111,0.25)'
      ctx.lineWidth = 1
      for (let i = 1; i < N; i++) {
        if (i % 3 === 0) continue
        ctx.beginPath()
        ctx.moveTo(BOARD_X + i * CELL + 0.5, BOARD_Y)
        ctx.lineTo(BOARD_X + i * CELL + 0.5, BOARD_Y + BOARD)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(BOARD_X, BOARD_Y + i * CELL + 0.5)
        ctx.lineTo(BOARD_X + BOARD, BOARD_Y + i * CELL + 0.5)
        ctx.stroke()
      }
      // thick neon box borders (every 3)
      ctx.save()
      ctx.strokeStyle = PINK
      ctx.shadowColor = PINK
      ctx.shadowBlur = 8
      ctx.lineWidth = 2.5
      for (let i = 0; i <= N; i += 3) {
        ctx.beginPath()
        ctx.moveTo(BOARD_X + i * CELL, BOARD_Y)
        ctx.lineTo(BOARD_X + i * CELL, BOARD_Y + BOARD)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(BOARD_X, BOARD_Y + i * CELL)
        ctx.lineTo(BOARD_X + BOARD, BOARD_Y + i * CELL)
        ctx.stroke()
      }
      ctx.restore()

      // numbers
      ctx.font = '600 26px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
          const v = board[r][c]
          if (v === 0) continue
          const cx = BOARD_X + c * CELL + CELL / 2
          const cy = BOARD_Y + r * CELL + CELL / 2 + 1
          let color = given[r][c] ? GIVEN : CYAN
          if (!given[r][c] && isConflict(r, c)) color = CONFLICT
          ctx.save()
          ctx.fillStyle = color
          if (!given[r][c]) { ctx.shadowColor = color; ctx.shadowBlur = 8 }
          ctx.fillText(String(v), cx, cy)
          ctx.restore()
        }
      }
      ctx.textAlign = 'left'
    }

    function drawPad() {
      ctx.font = '700 20px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (let i = 0; i < N; i++) {
        const x = PAD_X + i * (PAD_CELL + PAD_GAP)
        ctx.fillStyle = PANEL
        ctx.fillRect(x, PAD_Y, PAD_CELL, PAD_CELL)
        ctx.save()
        ctx.strokeStyle = 'rgba(45,226,230,0.5)'
        ctx.lineWidth = 1.5
        ctx.strokeRect(x + 0.5, PAD_Y + 0.5, PAD_CELL - 1, PAD_CELL - 1)
        ctx.restore()
        ctx.fillStyle = CYAN
        ctx.fillText(String(i + 1), x + PAD_CELL / 2, PAD_Y + PAD_CELL / 2 + 1)
      }
      ctx.textAlign = 'left'
    }

    function drawButton(x, w, label, accent) {
      ctx.save()
      ctx.strokeStyle = accent
      ctx.shadowColor = accent
      ctx.shadowBlur = 6
      ctx.lineWidth = 2
      ctx.strokeRect(x + 1, BTN_Y + 1, w - 2, BTN_H - 2)
      ctx.restore()
      ctx.fillStyle = accent
      ctx.font = '800 13px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(label.toUpperCase(), x + w / 2, BTN_Y + BTN_H / 2 + 1)
      ctx.textAlign = 'left'
    }

    function drawButtons() {
      const half = (BOARD - GAP) / 2
      drawButton(BOARD_X, half, 'New Game', PINK)
      drawButton(BOARD_X + half + GAP, half, 'Erase', CYAN)
    }

    function drawWin() {
      ctx.save()
      ctx.fillStyle = 'rgba(10,10,10,0.82)'
      ctx.fillRect(BOARD_X, BOARD_Y, BOARD, BOARD)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = CYAN
      ctx.shadowColor = CYAN
      ctx.shadowBlur = 18
      ctx.font = '800 40px system-ui, sans-serif'
      ctx.fillText('SOLVED', W / 2, BOARD_Y + BOARD / 2 - 16)
      ctx.shadowBlur = 6
      ctx.fillStyle = PINK
      ctx.shadowColor = PINK
      ctx.font = '800 18px system-ui, sans-serif'
      ctx.fillText(fmtTime(elapsed), W / 2, BOARD_Y + BOARD / 2 + 20)
      ctx.restore()
      ctx.textAlign = 'left'
    }

    function draw() {
      ctx.fillStyle = BG
      ctx.fillRect(0, 0, W, H)
      drawHeader()
      drawBoard()
      if (state === 'won') drawWin()
      drawPad()
      drawButtons()
    }

    function loop() {
      if (state === 'playing') elapsed = (performance.now() - startTime) / 1000
      draw()
      raf = requestAnimationFrame(loop)
    }

    // ---------- autoplay bot ----------
    // Solves the puzzle using the same backtracking solver, then fills cells one-by-one
    // on a watchable timer. Win rounds complete the grid; ~5% lose rounds fill ~40% and stop.
    let order = []       // empty cells to fill, in a shuffled order
    let fillIdx = 0
    let wantWin = true
    let stopAt = 0       // index at which a losing round bails out
    let recorded = false

    function botStartRound() {
      newGame()
      wantWin = shouldAutoWin('sudoku')
      recorded = false
      const empties = []
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
        if (board[r][c] === 0) empties.push([r, c])
      }
      order = shuffled(empties)
      fillIdx = 0
      stopAt = wantWin ? order.length : Math.floor(order.length * 0.4)
    }

    function botStep() {
      if (fillIdx >= stopAt) {
        // round finished (win) or deliberately abandoned (lose)
        if (!recorded) {
          recordAutoplayResult('sudoku', wantWin && state === 'won')
          recorded = true
        }
        botTimer = setTimeout(() => { botStartRound(); botTimer = setTimeout(botStep, 700) }, 1400)
        return
      }
      const [r, c] = order[fillIdx]
      sel = { r, c }
      board[r][c] = solution[r][c]
      fillIdx++
      if (fillIdx >= stopAt && wantWin) checkWin()
      const delay = 120 + Math.random() * 80 // 120-200ms, smooth solve
      botTimer = setTimeout(botStep, delay)
    }

    newGame()
    raf = requestAnimationFrame(loop)
    if (auto) {
      botStartRound()
      botTimer = setTimeout(botStep, 500)
    }

    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(botTimer)
      canvas.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      className="sudoku-canvas"
      aria-label="Sudoku game"
    />
  )
}
