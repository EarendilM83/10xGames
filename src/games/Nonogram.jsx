import { useEffect, useRef } from 'react'
import { isAutoplay, shouldAutoWin, recordAutoplayResult } from '../autoplay.js'

// Self-contained neon Nonogram (Picross) on canvas, with a built-in autoplay bot.
// Puzzles are guaranteed unique-solution: a random picture is generated, its row/col
// clues computed, then a constraint-propagation line-solver must fully solve it from
// the clues alone (otherwise the grid is regenerated). The same line-solver drives the
// autoplay bot, filling cells one-by-one on a timer for a smooth, watchable solve.

const N = 10                  // grid is N x N
const CELL = 34
const GRID = N * CELL         // 340
const CLUE_W = 130            // left margin for row clues
const CLUE_H = 130            // top margin for column clues
const MARGIN = 20
const HEADER_H = 56

const GRID_X = MARGIN + CLUE_W
const GRID_Y = HEADER_H + CLUE_H

const W = GRID_X + GRID + MARGIN              // 20 + 130 + 340 + 20 = 510
const H = GRID_Y + GRID + 70                  // header + clues + grid + footer

// 10x neon palette
const BG = '#0a0a0a'
const PINK = '#ff2d6f'
const CYAN = '#2de2e6'
const WHITE = '#f5f6fa'
const DIM = '#5a5a6a'
const PANEL = '#101018'

const HS_KEY = '10xgames.nonogram.best'

// ---------- pure puzzle helpers (module scope so a node test can't reach them,
//            but kept here as plain functions used inside the effect) ----------

export default function Nonogram() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const auto = isAutoplay('nonogram')

    // ---------------- generator + line solver ----------------

    // Run-length clues for a boolean line (array of 0/1). Empty line -> [0].
    function lineClues(line) {
      const out = []
      let run = 0
      for (let i = 0; i < line.length; i++) {
        if (line[i]) run++
        else { if (run) out.push(run); run = 0 }
      }
      if (run) out.push(run)
      return out.length ? out : [0]
    }

    // Enumerate all placements of `clues` into a line of `len`, intersecting with
    // known cells (state: 1 filled, 0 empty, -1 unknown). Returns {filled, empty}
    // arrays of booleans for cells that are filled / empty in EVERY valid placement,
    // or null if there is no valid placement (contradiction).
    function solveLine(clues, state) {
      const len = state.length
      const isBlank = clues.length === 1 && clues[0] === 0
      const groups = isBlank ? [] : clues
      const mustFilled = new Array(len).fill(true)
      const mustEmpty = new Array(len).fill(true)
      let any = false

      // backtracking placement; pos = current cell index, gi = group index
      const placement = new Array(len)
      function place(pos, gi) {
        if (gi === groups.length) {
          // remaining cells must be empty; verify against state
          for (let i = pos; i < len; i++) {
            placement[i] = 0
            if (state[i] === 1) return
          }
          // valid full placement -> intersect
          any = true
          for (let i = 0; i < len; i++) {
            if (placement[i]) mustEmpty[i] = false
            else mustFilled[i] = false
          }
          return
        }
        const g = groups[gi]
        // remaining minimum space needed for groups gi..end
        let need = 0
        for (let k = gi; k < groups.length; k++) need += groups[k] + (k > gi ? 1 : 0)
        const maxStart = len - need
        for (let start = pos; start <= maxStart; start++) {
          // cells pos..start-1 empty
          let ok = true
          for (let i = pos; i < start; i++) {
            if (state[i] === 1) { ok = false; break }
            placement[i] = 0
          }
          if (!ok) break // a filled-known cell can't be skipped past
          // cells start..start+g-1 filled
          for (let i = start; i < start + g; i++) {
            if (state[i] === 0) { ok = false; break }
            placement[i] = 1
          }
          if (!ok) continue
          // gap cell after group (if more groups follow) must be empty
          let next = start + g
          if (gi < groups.length - 1) {
            if (state[next] === 1) continue
            placement[next] = 0
            next++
          }
          place(next, gi + 1)
        }
      }
      place(0, 0)
      if (!any) return null
      return { filled: mustFilled, empty: mustEmpty }
    }

    // Try to solve a whole puzzle from clues alone via constraint propagation.
    // grid state: 2D array of -1/0/1. Returns true if fully + uniquely determined.
    function propagateSolve(rowClues, colClues) {
      const g = Array.from({ length: N }, () => new Array(N).fill(-1))
      let changed = true
      while (changed) {
        changed = false
        // rows
        for (let r = 0; r < N; r++) {
          const res = solveLine(rowClues[r], g[r])
          if (!res) return null
          for (let c = 0; c < N; c++) {
            if (res.filled[c] && g[r][c] !== 1) { g[r][c] = 1; changed = true }
            else if (res.empty[c] && g[r][c] !== 0) { g[r][c] = 0; changed = true }
          }
        }
        // cols
        for (let c = 0; c < N; c++) {
          const col = new Array(N)
          for (let r = 0; r < N; r++) col[r] = g[r][c]
          const res = solveLine(colClues[c], col)
          if (!res) return null
          for (let r = 0; r < N; r++) {
            if (res.filled[r] && g[r][c] !== 1) { g[r][c] = 1; changed = true }
            else if (res.empty[r] && g[r][c] !== 0) { g[r][c] = 0; changed = true }
          }
        }
      }
      // fully solved?
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (g[r][c] === -1) return null
      return g
    }

    // Generate a unique-solution picture. Returns { solution, rowClues, colClues }.
    function generatePuzzle() {
      for (let attempt = 0; attempt < 400; attempt++) {
        const density = 0.45 + Math.random() * 0.15
        const sol = Array.from({ length: N }, () =>
          Array.from({ length: N }, () => (Math.random() < density ? 1 : 0)))
        // avoid fully-empty rows/cols clutter is fine; just need at least some fills
        let total = 0
        for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) total += sol[r][c]
        if (total < N) continue
        const rowClues = sol.map(lineClues)
        const colClues = []
        for (let c = 0; c < N; c++) {
          const col = new Array(N)
          for (let r = 0; r < N; r++) col[r] = sol[r][c]
          colClues.push(lineClues(col))
        }
        const solved = propagateSolve(rowClues, colClues)
        if (!solved) continue
        // verify the propagated solution matches our picture (uniqueness)
        let ok = true
        for (let r = 0; r < N && ok; r++) for (let c = 0; c < N; c++) {
          if (solved[r][c] !== sol[r][c]) { ok = false; break }
        }
        if (ok) return { solution: sol, rowClues, colClues }
      }
      // extremely unlikely fallback: a trivial diagonal puzzle (always unique)
      const sol = Array.from({ length: N }, (_, r) =>
        Array.from({ length: N }, (_, c) => (r === c ? 1 : 0)))
      const rowClues = sol.map(lineClues)
      const colClues = []
      for (let c = 0; c < N; c++) {
        const col = new Array(N)
        for (let r = 0; r < N; r++) col[r] = sol[r][c]
        colClues.push(lineClues(col))
      }
      return { solution: sol, rowClues, colClues }
    }

    // ---------------- game state ----------------
    let solution, rowClues, colClues
    let grid                // player marks: 0 empty, 1 filled, 2 X-marked
    let state = 'playing'   // 'playing' | 'won'
    let mode = 'fill'       // 'fill' | 'mark'  (left-click behavior toggle)
    let startTime = 0
    let elapsed = 0
    let best = loadBest()
    let raf = 0
    let shakeT = 0

    // autoplay scheduling
    let autoTimer = null
    let restartTimer = null
    let autoSteps = []      // queued [r,c,value] moves for the bot
    let autoIdx = 0
    let wantWin = true
    let autoRecorded = false

    function loadBest() {
      try {
        const v = parseInt(localStorage.getItem(HS_KEY), 10)
        return Number.isFinite(v) ? v : null
      } catch { return null }
    }
    function saveBest(v) {
      try { localStorage.setItem(HS_KEY, String(v)) } catch { /* ignore */ }
    }

    function newPuzzle() {
      const p = generatePuzzle()
      solution = p.solution
      rowClues = p.rowClues
      colClues = p.colClues
      grid = Array.from({ length: N }, () => new Array(N).fill(0))
      state = 'playing'
      startTime = performance.now()
      elapsed = 0
      shakeT = 0
      autoRecorded = false
      if (auto) setupAuto()
    }

    // ---- autoplay: build a move list from the line solver ----
    function setupAuto() {
      wantWin = shouldAutoWin('nonogram')
      // full solution order: solve grid with propagation, then list filled cells
      // (and the empty cells as X marks) in a pleasant row-major-ish order.
      const moves = []
      // we walk the actual solution; bot fills filled cells and X-marks blanks.
      for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
          moves.push([r, c, solution[r][c] ? 1 : 2])
        }
      }
      autoSteps = moves
      autoIdx = 0
      if (!wantWin) {
        // lose round: only do ~40% of the moves then stop
        const cut = Math.floor(moves.length * 0.4)
        autoSteps = moves.slice(0, cut)
      }
      scheduleAutoStep()
    }

    function scheduleAutoStep() {
      if (autoTimer) { clearTimeout(autoTimer); autoTimer = null }
      const delay = 80 + Math.random() * 80   // 80..160ms
      autoTimer = setTimeout(autoStep, delay)
    }

    function autoStep() {
      autoTimer = null
      if (state !== 'playing') return
      if (autoIdx >= autoSteps.length) {
        // bot is done feeding moves
        if (wantWin) {
          // should have won via checkWin already; safety fallthrough
        } else {
          // lose round: finished partial fill, record + restart
          finishAuto(false)
        }
        return
      }
      const [r, c, v] = autoSteps[autoIdx++]
      grid[r][c] = v
      const won = checkWin()
      if (won) return          // checkWin handles finishAuto
      scheduleAutoStep()
    }

    function finishAuto(solved) {
      if (autoRecorded) return
      autoRecorded = true
      recordAutoplayResult('nonogram', solved)
      if (restartTimer) clearTimeout(restartTimer)
      restartTimer = setTimeout(() => { newPuzzle() }, 1400)
    }

    // ---- win check ----
    function checkWin() {
      for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
          const filled = grid[r][c] === 1
          if (filled !== !!solution[r][c]) return false
        }
      }
      state = 'won'
      elapsed = Math.round((performance.now() - startTime) / 1000)
      if (best == null || elapsed < best) { best = elapsed; saveBest(best) }
      if (auto) finishAuto(true)
      return true
    }

    // ---- clue satisfaction (for crossing out) ----
    // Returns boolean array per clue indicating "this clue's run is satisfied" — a
    // simple heuristic: the line's current filled runs equal the clue exactly.
    function lineSatisfied(clues, line) {
      // line here = array of booleans (filled or not)
      const runs = lineClues(line.map((v) => (v ? 1 : 0)))
      if (clues.length === 1 && clues[0] === 0) {
        return [line.every((v) => !v)]
      }
      if (runs.length !== clues.length) return clues.map(() => false)
      let same = true
      for (let i = 0; i < runs.length; i++) if (runs[i] !== clues[i]) same = false
      return clues.map(() => same)
    }

    // ---------------- input ----------------
    function cellAt(ev) {
      const rect = canvas.getBoundingClientRect()
      const sx = canvas.width / rect.width
      const sy = canvas.height / rect.height
      const x = (ev.clientX - rect.left) * sx
      const y = (ev.clientY - rect.top) * sy
      const c = Math.floor((x - GRID_X) / CELL)
      const r = Math.floor((y - GRID_Y) / CELL)
      if (r < 0 || r >= N || c < 0 || c >= N) return null
      return { r, c }
    }

    function applyMark(r, c, asMark) {
      if (state !== 'playing') return
      if (asMark) {
        grid[r][c] = grid[r][c] === 2 ? 0 : 2
      } else {
        grid[r][c] = grid[r][c] === 1 ? 0 : 1
        // shake feedback if this fill contradicts solution
        if (grid[r][c] === 1 && !solution[r][c]) shakeT = performance.now()
      }
      checkWin()
    }

    function onMouseDown(ev) {
      if (auto) return
      if (state === 'won') { newPuzzle(); return }
      const cell = cellAt(ev)
      if (!cell) return
      ev.preventDefault()
      const asMark = ev.button === 2 || mode === 'mark'
      applyMark(cell.r, cell.c, asMark)
    }
    function onContextMenu(ev) {
      ev.preventDefault()
      if (auto || state !== 'playing') return
      const cell = cellAt(ev)
      if (!cell) return
      applyMark(cell.r, cell.c, true)
    }
    function onKey(ev) {
      const k = ev.key.toLowerCase()
      if (k === 'n') { if (!auto) newPuzzle() }
      else if (k === 'x' || k === 'm') { mode = mode === 'fill' ? 'mark' : 'fill' }
    }

    canvas.addEventListener('mousedown', onMouseDown)
    canvas.addEventListener('contextmenu', onContextMenu)
    window.addEventListener('keydown', onKey)

    // ---------------- drawing ----------------
    function rrect(x, y, w, h, r) {
      ctx.beginPath()
      ctx.moveTo(x + r, y)
      ctx.arcTo(x + w, y, x + w, y + h, r)
      ctx.arcTo(x + w, y + h, x, y + h, r)
      ctx.arcTo(x, y + h, x, y, r)
      ctx.arcTo(x, y, x + w, y, r)
      ctx.closePath()
    }

    function sparkle(x, y) {
      ctx.save()
      ctx.strokeStyle = PINK
      ctx.shadowColor = PINK
      ctx.shadowBlur = 8
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(x - 6, y); ctx.lineTo(x + 6, y)
      ctx.moveTo(x, y - 6); ctx.lineTo(x, y + 6)
      ctx.stroke()
      ctx.restore()
    }

    function draw() {
      // background
      ctx.fillStyle = BG
      ctx.fillRect(0, 0, W, H)

      // faint grid backdrop
      ctx.strokeStyle = 'rgba(255,45,111,0.02)'
      ctx.lineWidth = 1
      for (let x = 0; x <= W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke() }
      for (let y = 0; y <= H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke() }

      // sparkle corners
      sparkle(14, 14); sparkle(W - 14, 14); sparkle(14, H - 14); sparkle(W - 14, H - 14)

      // header label
      ctx.save()
      ctx.fillStyle = PINK
      ctx.shadowColor = PINK
      ctx.shadowBlur = 12
      ctx.font = 'bold 26px system-ui, sans-serif'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText('NONOGRAM', MARGIN, HEADER_H / 2 + 4)
      const labW = ctx.measureText('NONOGRAM').width
      ctx.fillRect(MARGIN, HEADER_H / 2 + 20, labW, 3)
      ctx.restore()

      // timer + best (right side of header)
      ctx.save()
      ctx.fillStyle = WHITE
      ctx.font = '14px system-ui, sans-serif'
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      const t = state === 'won' ? elapsed : Math.round((performance.now() - startTime) / 1000)
      ctx.fillText(`TIME ${t}s`, W - MARGIN, 20)
      ctx.fillStyle = DIM
      ctx.fillText(best != null ? `BEST ${best}s` : 'BEST —', W - MARGIN, 40)
      ctx.restore()

      // shake offset for the grid on a wrong fill
      let ox = 0
      if (shakeT) {
        const dt = performance.now() - shakeT
        if (dt < 320) ox = Math.sin(dt / 24) * (6 * (1 - dt / 320))
        else shakeT = 0
      }

      ctx.save()
      ctx.translate(ox, 0)

      // current filled lines (booleans) for clue cross-out
      const rowFilled = grid.map((row) => row.map((v) => v === 1))
      const colFilled = []
      for (let c = 0; c < N; c++) {
        const col = new Array(N)
        for (let r = 0; r < N; r++) col[r] = grid[r][c] === 1
        colFilled.push(col)
      }

      // ---- column clues (top) ----
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = 'bold 14px system-ui, sans-serif'
      for (let c = 0; c < N; c++) {
        const cx = GRID_X + c * CELL + CELL / 2
        const clues = colClues[c]
        const sat = lineSatisfied(clues, colFilled[c])
        for (let i = 0; i < clues.length; i++) {
          const cy = GRID_Y - 14 - (clues.length - 1 - i) * 18
          ctx.fillStyle = clues[i] === 0 ? DIM : (sat[i] ? DIM : WHITE)
          ctx.fillText(String(clues[i]), cx, cy)
        }
      }

      // ---- row clues (left) ----
      ctx.textAlign = 'right'
      for (let r = 0; r < N; r++) {
        const cy = GRID_Y + r * CELL + CELL / 2
        const clues = rowClues[r]
        const sat = lineSatisfied(clues, rowFilled[r])
        for (let i = 0; i < clues.length; i++) {
          const cx = GRID_X - 12 - (clues.length - 1 - i) * 22
          ctx.fillStyle = clues[i] === 0 ? DIM : (sat[i] ? DIM : WHITE)
          ctx.fillText(String(clues[i]), cx, cy)
        }
      }

      // ---- cells ----
      for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
          const x = GRID_X + c * CELL
          const y = GRID_Y + r * CELL
          const v = grid[r][c]
          if (v === 1) {
            const wrong = state !== 'won' && !solution[r][c]
            ctx.save()
            ctx.fillStyle = wrong ? PINK : CYAN
            ctx.shadowColor = wrong ? PINK : CYAN
            ctx.shadowBlur = 12
            rrect(x + 3, y + 3, CELL - 6, CELL - 6, 5)
            ctx.fill()
            ctx.restore()
          } else if (v === 2) {
            ctx.save()
            ctx.strokeStyle = DIM
            ctx.lineWidth = 2.5
            ctx.beginPath()
            ctx.moveTo(x + 10, y + 10); ctx.lineTo(x + CELL - 10, y + CELL - 10)
            ctx.moveTo(x + CELL - 10, y + 10); ctx.lineTo(x + 10, y + CELL - 10)
            ctx.stroke()
            ctx.restore()
          }
        }
      }

      // ---- grid lines (neon pink, thicker every 5) ----
      for (let i = 0; i <= N; i++) {
        const major = i % 5 === 0
        ctx.strokeStyle = major ? PINK : 'rgba(255,45,111,0.28)'
        ctx.lineWidth = major ? 2.5 : 1
        ctx.shadowColor = major ? PINK : 'transparent'
        ctx.shadowBlur = major ? 6 : 0
        // vertical
        ctx.beginPath()
        ctx.moveTo(GRID_X + i * CELL, GRID_Y)
        ctx.lineTo(GRID_X + i * CELL, GRID_Y + GRID)
        ctx.stroke()
        // horizontal
        ctx.beginPath()
        ctx.moveTo(GRID_X, GRID_Y + i * CELL)
        ctx.lineTo(GRID_X + GRID, GRID_Y + i * CELL)
        ctx.stroke()
      }
      ctx.shadowBlur = 0

      ctx.restore() // shake

      // ---- footer controls / status ----
      ctx.save()
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const fy = GRID_Y + GRID + 30
      if (state === 'won') {
        ctx.fillStyle = CYAN
        ctx.shadowColor = CYAN
        ctx.shadowBlur = 14
        ctx.font = 'bold 22px system-ui, sans-serif'
        ctx.fillText(auto ? 'SOLVED' : 'SOLVED — press N for new', W / 2, fy)
      } else {
        ctx.fillStyle = DIM
        ctx.font = '13px system-ui, sans-serif'
        if (auto) {
          ctx.fillText('AUTOPLAY — bot solving…', W / 2, fy)
        } else {
          const m = mode === 'fill' ? 'FILL' : 'MARK X'
          ctx.fillText(`LEFT fill · RIGHT mark X · X toggle mode (${m}) · N new`, W / 2, fy)
        }
      }
      ctx.restore()

      raf = requestAnimationFrame(draw)
    }

    // ---------------- boot ----------------
    newPuzzle()
    raf = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(raf)
      if (autoTimer) clearTimeout(autoTimer)
      if (restartTimer) clearTimeout(restartTimer)
      canvas.removeEventListener('mousedown', onMouseDown)
      canvas.removeEventListener('contextmenu', onContextMenu)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      className="nonogram-canvas"
      aria-label="Nonogram game"
    />
  )
}
