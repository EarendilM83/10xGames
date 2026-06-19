import { useEffect, useRef } from 'react'
import { solve } from './minesweeperSolver.js'
import { isAutoplay, shouldAutoWin, recordAutoplayResult } from '../autoplay.js'

// Classic Win95-style Minesweeper, rendered on canvas to match the Figma design.
const COLS = 16
const ROWS = 16
const MINES = 40
const CELL = 26
const BORDER = 12
const HEADER_H = 52
const GAP = 8

const BOARD_X = BORDER
const BOARD_Y = BORDER + HEADER_H + GAP
const W = BORDER * 2 + COLS * CELL
const H = BOARD_Y + ROWS * CELL + BORDER

// 10x dark theme
const FACE = '#1d1d26'      // raised surfaces (tiles, frame, panel)
const LIGHT = '#34343f'     // bevel highlight
const DARK = '#070709'      // bevel shadow
const REVEALED = '#0e0e13'  // opened tile face
const PINK = '#ff2d6f'
// neon adjacency colors, readable on dark
const NUM_COLORS = ['', '#4d7cff', '#54e346', '#ff2d6f', '#b14aed', '#ff8a1e', '#2de2e6', '#ffffff', '#8a93ad']

const HS_KEY = '10xgames.minesweeper.best'

export default function Minesweeper() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const auto = isAutoplay('minesweeper')

    let grid = []
    let state = 'ready' // ready | playing | won | lost
    let flags = 0
    let score = 0 // points: safe cells cleared (the working "points counter")
    let firstClick = true
    let elapsed = 0
    let startTime = 0
    let hover = { r: -1, c: -1 }
    let best = Number(localStorage.getItem(HS_KEY)) || 0
    let raf = 0

    function newGame() {
      grid = []
      for (let r = 0; r < ROWS; r++) {
        const row = []
        for (let c = 0; c < COLS; c++) {
          row.push({ mine: false, adj: 0, revealed: false, flagged: false })
        }
        grid.push(row)
      }
      state = 'ready'
      flags = 0
      score = 0
      firstClick = true
      elapsed = 0
      startTime = 0
    }

    // Generate-and-reject: keep placing mines (first click + neighbors always safe)
    // until the solver confirms the board is fully clearable by logic — a "no-guess" board.
    function placeMines(safeR, safeC) {
      const CAP = 3000
      let chosen = null
      for (let attempt = 0; attempt < CAP; attempt++) {
        const m = Array.from({ length: ROWS }, () => new Array(COLS).fill(false))
        let placed = 0
        while (placed < MINES) {
          const r = Math.floor(Math.random() * ROWS)
          const c = Math.floor(Math.random() * COLS)
          if (m[r][c]) continue
          if (Math.abs(r - safeR) <= 1 && Math.abs(c - safeC) <= 1) continue // safe opening
          m[r][c] = true
          placed++
        }
        chosen = m
        if (solve(m, ROWS, COLS, MINES, safeR, safeC)) break // logically solvable → keep it
      }
      // commit (chosen is the last/solvable layout; fallback to last if cap hit)
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) grid[r][c].mine = chosen[r][c]
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          if (grid[r][c].mine) continue
          let n = 0
          forNeighbors(r, c, (rr, cc) => { if (grid[rr][cc].mine) n++ })
          grid[r][c].adj = n
        }
      }
    }

    function forNeighbors(r, c, fn) {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue
          const rr = r + dr, cc = c + dc
          if (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS) fn(rr, cc)
        }
      }
    }

    function reveal(r, c) {
      const cell = grid[r][c]
      if (cell.revealed || cell.flagged) return
      // flood fill (iterative)
      const stack = [[r, c]]
      while (stack.length) {
        const [cr, cc] = stack.pop()
        const cur = grid[cr][cc]
        if (cur.revealed || cur.flagged) continue
        cur.revealed = true
        if (cur.mine) { loseGame(); return }
        score++ // each safe cell cleared = 1 point
        if (score > best) { best = score; localStorage.setItem(HS_KEY, String(best)) }
        if (cur.adj === 0) forNeighbors(cr, cc, (rr, ccc) => {
          if (!grid[rr][ccc].revealed) stack.push([rr, ccc])
        })
      }
      checkWin()
    }

    function loseGame() {
      state = 'lost'
      for (const row of grid) for (const cell of row) if (cell.mine) cell.revealed = true
    }

    function checkWin() {
      let hidden = 0
      for (const row of grid) for (const cell of row) if (!cell.revealed && !cell.mine) hidden++
      if (hidden === 0) {
        state = 'won'
        // auto-flag remaining mines
        for (const row of grid) for (const cell of row) if (cell.mine && !cell.flagged) { cell.flagged = true }
        flags = MINES
      }
    }

    function toggleFlag(r, c) {
      const cell = grid[r][c]
      if (cell.revealed) return
      cell.flagged = !cell.flagged
      flags += cell.flagged ? 1 : -1
    }

    function startIfNeeded(r, c) {
      if (firstClick) {
        placeMines(r, c)
        firstClick = false
        state = 'playing'
        startTime = performance.now()
      }
    }

    // ---------- input ----------
    function cellAt(e) {
      const rect = canvas.getBoundingClientRect()
      const x = (e.clientX - rect.left) * (W / rect.width)
      const y = (e.clientY - rect.top) * (H / rect.height)
      const c = Math.floor((x - BOARD_X) / CELL)
      const r = Math.floor((y - BOARD_Y) / CELL)
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return null
      return { r, c, x, y }
    }

    function onDown(e) {
      e.preventDefault()
      // reset button hit?
      const rect = canvas.getBoundingClientRect()
      const x = (e.clientX - rect.left) * (W / rect.width)
      const y = (e.clientY - rect.top) * (H / rect.height)
      const bx = W / 2 - 15, by = BORDER + 6
      if (x >= bx && x <= bx + 30 && y >= by && y <= by + 30) { newGame(); return }

      if (state === 'won' || state === 'lost') return
      const hit = cellAt(e)
      if (!hit) return
      if (e.button === 2) { toggleFlag(hit.r, hit.c); return } // right-click flag
      startIfNeeded(hit.r, hit.c)
      reveal(hit.r, hit.c)
    }

    function onMove(e) {
      const hit = cellAt(e)
      hover = hit ? { r: hit.r, c: hit.c } : { r: -1, c: -1 }
    }

    function onKey(e) {
      if (e.code === 'KeyR') { newGame(); return }
      if (e.code === 'Space') {
        e.preventDefault()
        if (state === 'won' || state === 'lost') return
        if (hover.r >= 0) {
          startIfNeeded(hover.r, hover.c)
          toggleFlag(hover.r, hover.c)
        }
      }
    }

    const onContext = (e) => e.preventDefault()

    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('contextmenu', onContext)
    window.addEventListener('keydown', onKey)

    // ---------- drawing ----------
    function bevel(x, y, w, h, raised, size = 2) {
      ctx.fillStyle = FACE
      ctx.fillRect(x, y, w, h)
      ctx.fillStyle = raised ? LIGHT : DARK
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w - size, y + size); ctx.lineTo(x + size, y + size); ctx.lineTo(x + size, y + h - size); ctx.lineTo(x, y + h); ctx.fill()
      ctx.fillStyle = raised ? DARK : LIGHT
      ctx.beginPath(); ctx.moveTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x + size, y + h - size); ctx.lineTo(x + w - size, y + h - size); ctx.lineTo(x + w - size, y + size); ctx.lineTo(x + w, y); ctx.fill()
    }

    function led(x, y, value, lbl) {
      const w = 46, h = 26
      ctx.fillStyle = '#000'; ctx.fillRect(x, y, w, h)
      ctx.fillStyle = PINK
      ctx.font = 'bold 22px "Courier New", monospace'
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle'
      const str = String(Math.max(-99, Math.min(999, value))).padStart(3, '0')
      ctx.fillText(str, x + w - 5, y + h / 2 + 1)
      if (lbl) {
        ctx.fillStyle = PINK; ctx.font = '700 8px system-ui, sans-serif'
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
        ctx.fillText(lbl, x, y + h + 8)
      }
    }

    function drawFace(cx, cy) {
      const r = 9
      ctx.fillStyle = '#ffd60a'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
      ctx.fillStyle = '#000'
      if (state === 'lost') {
        // x eyes
        ctx.font = 'bold 7px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillText('x', cx - 3.5, cy - 2); ctx.fillText('x', cx + 3.5, cy - 2)
        ctx.beginPath(); ctx.arc(cx, cy + 4, 3, Math.PI, 0); ctx.stroke()
      } else if (state === 'won') {
        ctx.fillRect(cx - 5, cy - 3, 3.5, 2); ctx.fillRect(cx + 1.5, cy - 3, 3.5, 2) // sunglasses
        ctx.beginPath(); ctx.arc(cx, cy + 2, 3, 0, Math.PI); ctx.stroke()
      } else {
        ctx.beginPath(); ctx.arc(cx - 3, cy - 2, 1.3, 0, Math.PI * 2); ctx.fill()
        ctx.beginPath(); ctx.arc(cx + 3, cy - 2, 1.3, 0, Math.PI * 2); ctx.fill()
        ctx.beginPath(); ctx.arc(cx, cy + 2, 4, 0, Math.PI); ctx.stroke()
      }
    }

    function drawCell(r, c) {
      const x = BOARD_X + c * CELL, y = BOARD_Y + r * CELL
      const cell = grid[r][c]
      if (!cell.revealed) {
        bevel(x, y, CELL, CELL, true)
        if (cell.flagged) {
          ctx.fillStyle = '#cfd3dc'; ctx.fillRect(x + CELL / 2 - 1, y + 6, 2, 12) // pole
          ctx.fillStyle = '#cfd3dc'; ctx.fillRect(x + 7, y + 17, 12, 3) // base
          ctx.fillStyle = PINK
          ctx.beginPath(); ctx.moveTo(x + CELL / 2 - 1, y + 6); ctx.lineTo(x + CELL / 2 - 1, y + 13); ctx.lineTo(x + 7, y + 9.5); ctx.fill()
        }
      } else {
        // revealed flat
        ctx.fillStyle = REVEALED; ctx.fillRect(x, y, CELL, CELL)
        ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1)
        if (cell.mine) {
          if (state === 'lost') { ctx.fillStyle = 'rgba(255,45,111,0.35)'; ctx.fillRect(x, y, CELL, CELL) }
          ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1)
          ctx.fillStyle = '#ffffff'
          ctx.beginPath(); ctx.arc(x + CELL / 2, y + CELL / 2, 5, 0, Math.PI * 2); ctx.fill()
          ctx.fillRect(x + CELL / 2 - 7, y + CELL / 2 - 0.5, 14, 1)
          ctx.fillRect(x + CELL / 2 - 0.5, y + CELL / 2 - 7, 1, 14)
        } else if (cell.adj > 0) {
          ctx.fillStyle = NUM_COLORS[cell.adj]
          ctx.font = 'bold 15px "Courier New", monospace'
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
          ctx.fillText(String(cell.adj), x + CELL / 2, y + CELL / 2 + 1)
        }
      }
    }

    function draw() {
      // outer frame
      ctx.fillStyle = FACE; ctx.fillRect(0, 0, W, H)
      bevel(0, 0, W, H, false, 3)
      // header panel
      bevel(BORDER - 4, BORDER - 4, W - (BORDER - 4) * 2, HEADER_H, false)
      led(BORDER + 2, BORDER + 6, MINES - flags, 'MINES')
      led(BORDER + 70, BORDER + 6, score, 'SCORE')
      led(W - BORDER - 48, BORDER + 6, state === 'playing' ? Math.floor(elapsed) : Math.ceil(elapsed), 'TIME')
      bevel(W / 2 - 15, BORDER + 6, 30, 30, true)
      drawFace(W / 2, BORDER + 21)
      // board frame
      bevel(BOARD_X - 4, BOARD_Y - 4, COLS * CELL + 8, ROWS * CELL + 8, false, 3)
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) drawCell(r, c)
    }

    function loop() {
      if (state === 'playing') elapsed = (performance.now() - startTime) / 1000
      draw()
      raf = requestAnimationFrame(loop)
    }

    // ---------- autoplay bot ----------
    // Drives the game's OWN reveal/toggleFlag/newGame on a timer. Single-point logic:
    // for each revealed number, if flagged-neighbors == number → reveal remaining hidden
    // neighbors (safe); if (number - flagged) == hidden-neighbors → flag them (mines).
    let botTimer = 0
    let wantWin = true
    let safeSteps = 0 // safe deductions made this round (used to delay the deliberate loss)
    let recorded = false // ensures recordAutoplayResult fires exactly once per round

    function hiddenNeighbors(r, c) {
      const out = []
      forNeighbors(r, c, (rr, cc) => { const cell = grid[rr][cc]; if (!cell.revealed && !cell.flagged) out.push([rr, cc]) })
      return out
    }
    function flaggedCount(r, c) {
      let n = 0
      forNeighbors(r, c, (rr, cc) => { if (grid[rr][cc].flagged) n++ })
      return n
    }

    // Returns one deduced move: { kind: 'reveal'|'flag', r, c }, or null if none found.
    function deduceMove() {
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const cell = grid[r][c]
          if (!cell.revealed || cell.adj === 0) continue
          const hidden = hiddenNeighbors(r, c)
          if (hidden.length === 0) continue
          const flagged = flaggedCount(r, c)
          if (flagged === cell.adj) {
            return { kind: 'reveal', r: hidden[0][0], c: hidden[0][1] }
          }
          if (cell.adj - flagged === hidden.length) {
            return { kind: 'flag', r: hidden[0][0], c: hidden[0][1] }
          }
        }
      }
      return null
    }

    function randomHidden() {
      const opts = []
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const cell = grid[r][c]
        if (!cell.revealed && !cell.flagged) opts.push([r, c])
      }
      return opts.length ? opts[Math.floor(Math.random() * opts.length)] : null
    }

    function botStartRound() {
      wantWin = shouldAutoWin('minesweeper')
      safeSteps = 0
      recorded = false
      // First reveal generates the board (center cell). startIfNeeded places mines safely.
      const sr = Math.floor(ROWS / 2), sc = Math.floor(COLS / 2)
      startIfNeeded(sr, sc)
      reveal(sr, sc)
    }

    function botStep() {
      if (state === 'won' || state === 'lost') {
        if (!recorded) { recordAutoplayResult('minesweeper', state === 'won'); recorded = true }
        botTimer = setTimeout(() => { newGame(); botStartRound() }, 1500)
        return
      }
      // Lose rounds: take a couple of safe steps, then poke a random hidden cell (likely a mine).
      if (!wantWin && safeSteps >= 2) {
        const pick = randomHidden()
        if (pick) reveal(pick[0], pick[1])
      } else {
        // Win path: boards are no-guess solvable, so single-point logic deduces every move.
        const mv = deduceMove()
        if (mv) {
          if (mv.kind === 'reveal') { reveal(mv.r, mv.c); safeSteps++ }
          else toggleFlag(mv.r, mv.c)
        } else if (!wantWin) {
          // Lose round before reaching the step threshold — keep things moving.
          const pick = randomHidden()
          if (pick) reveal(pick[0], pick[1])
        }
        // Win round with no deduction yet: wait a tick; logic will catch up as cells reveal.
      }
      const delay = 220 + Math.random() * 160 // 220-380ms per action, smooth/watchable
      botTimer = setTimeout(botStep, delay)
    }

    newGame()
    raf = requestAnimationFrame(loop)
    if (auto) {
      botStartRound()
      botTimer = setTimeout(botStep, 400)
    }

    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(botTimer)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('contextmenu', onContext)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      className="ms-canvas"
      aria-label="Minesweeper game"
    />
  )
}
