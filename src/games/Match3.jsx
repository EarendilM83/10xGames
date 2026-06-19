import { useEffect, useRef } from 'react'
import { isAutoplay, shouldAutoWin, recordAutoplayResult } from '../autoplay.js'

// Match-3 (Bejeweled-style) on canvas, 10x neon style.
// Click a gem then an adjacent gem to swap (or click-drag). Valid only if it
// makes a line of >=3. Matches clear, gravity pulls gems down, top refills,
// cascades chain for escalating bonus. 30-move score-attack.

const COLS = 8
const ROWS = 8
const CELL = 52
const TOP = 80                       // HUD height above the board
const W = COLS * CELL                 // 416
const H = TOP + ROWS * CELL           // 80 + 416 = 496
const PAD = 6                         // inner padding of a gem within its cell
const MAX_MOVES = 30
const WIN_SCORE = 2500   // autoplay "win" threshold after the 30 moves

const PINK = '#ff2d6f'
const MUTED = '#8a93ad'
// 6 distinct neon hues
const COLORS = ['#ff2d6f', '#2de2e6', '#b14aed', '#54e346', '#ffd60a', '#ff8a1e']
const NTYPES = COLORS.length

const BEST_KEY = '10xgames.match3.best'

const SWAP_DUR = 0.16     // seconds for a swap/reject animation
const FALL_SPEED = 12     // cells per second for falling gems

export default function Match3() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')

    const auto = isAutoplay('match-3')

    // grid[r][c] = type index 0..5, or -1 for empty
    let grid
    let score, best, moves, state
    let combo                 // current cascade chain count
    let selected              // {r,c} or null
    let phase                 // 'idle' | 'swap' | 'reject' | 'resolve'
    let anim                  // active animation descriptor or null
    let particles
    let flash                 // {cells:Set, t} glow on cleared gems
    let last = performance.now(), raf = 0

    best = Number(localStorage.getItem(BEST_KEY)) || 0

    const key = (r, c) => r + ',' + c

    function randType() { return (Math.random() * NTYPES) | 0 }

    // --- match detection ---
    // returns a Set of "r,c" keys that are part of any horizontal/vertical run >=3
    function findMatches(g) {
      const matched = new Set()
      // horizontal
      for (let r = 0; r < ROWS; r++) {
        let runStart = 0
        for (let c = 1; c <= COLS; c++) {
          if (c < COLS && g[r][c] !== -1 && g[r][c] === g[r][runStart]) continue
          const len = c - runStart
          if (g[r][runStart] !== -1 && len >= 3) {
            for (let k = runStart; k < c; k++) matched.add(key(r, k))
          }
          runStart = c
        }
      }
      // vertical
      for (let c = 0; c < COLS; c++) {
        let runStart = 0
        for (let r = 1; r <= ROWS; r++) {
          if (r < ROWS && g[r][c] !== -1 && g[r][c] === g[runStart][c]) continue
          const len = r - runStart
          if (g[runStart][c] !== -1 && len >= 3) {
            for (let k = runStart; k < r; k++) matched.add(key(k, c))
          }
          runStart = r
        }
      }
      return matched
    }

    // would swapping (r1,c1)<->(r2,c2) create a match?
    function swapMakesMatch(r1, c1, r2, c2) {
      const t = grid[r1][c1]
      grid[r1][c1] = grid[r2][c2]
      grid[r2][c2] = t
      const m = findMatches(grid)
      // swap back
      grid[r2][c2] = grid[r1][c1]
      grid[r1][c1] = t
      return m.size > 0
    }

    // is there any legal move available?
    function hasMove() {
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          if (c + 1 < COLS && swapMakesMatch(r, c, r, c + 1)) return true
          if (r + 1 < ROWS && swapMakesMatch(r, c, r + 1, c)) return true
        }
      }
      return false
    }

    // fill grid with no pre-existing matches (used for fresh board / reshuffle)
    function fillNoMatches() {
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          let t
          do {
            t = randType()
          } while (
            (c >= 2 && grid[r][c - 1] === t && grid[r][c - 2] === t) ||
            (r >= 2 && grid[r - 1][c] === t && grid[r - 2][c] === t)
          )
          grid[r][c] = t
        }
      }
    }

    function buildBoard() {
      grid = Array.from({ length: ROWS }, () => new Array(COLS).fill(-1))
      do {
        fillNoMatches()
      } while (!hasMove())
    }

    function newGame() {
      buildBoard()
      score = 0
      moves = MAX_MOVES
      combo = 0
      selected = null
      phase = 'idle'
      anim = null
      particles = []
      flash = null
      state = 'playing'
    }

    // --- coordinate helpers ---
    function cellRect(r, c) {
      return { x: c * CELL, y: TOP + r * CELL }
    }
    function cellAt(px, py) {
      if (py < TOP) return null
      const c = Math.floor(px / CELL)
      const r = Math.floor((py - TOP) / CELL)
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return null
      return { r, c }
    }

    function spawnBurst(r, c, type) {
      const { x, y } = cellRect(r, c)
      const cx = x + CELL / 2, cy = y + CELL / 2
      for (let i = 0; i < 7; i++) {
        const a = Math.random() * Math.PI * 2
        const sp = 60 + Math.random() * 160
        particles.push({
          x: cx, y: cy,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          life: 0.4 + Math.random() * 0.3, t: 0, color: COLORS[type],
        })
      }
    }

    // --- resolve loop: clear matches, gravity, refill, cascade ---
    // Driven by phases so each visual step animates. Called repeatedly when
    // phase==='resolve' once the current fall animation completes.
    function resolveStep() {
      const matched = findMatches(grid)
      if (matched.size === 0) {
        // chain finished
        combo = 0
        phase = 'idle'
        // out of moves? game over. else ensure a move exists.
        if (moves <= 0) {
          endGame()
        } else if (!hasMove()) {
          // dead board mid-game: reshuffle existing types until a move exists
          reshuffle()
        }
        return
      }

      combo += 1
      // scoring: base 30 per gem, bonus for big clears, escalating combo multiplier
      const n = matched.size
      let gained = n * 30
      if (n >= 5) gained += 120
      else if (n === 4) gained += 50
      gained *= combo
      score += gained

      // flash + particles, then clear
      flash = { cells: new Set(matched), t: 0 }
      for (const cell of matched) {
        const [r, c] = cell.split(',').map(Number)
        spawnBurst(r, c, grid[r][c])
        grid[r][c] = -1
      }

      applyGravity()
      // gravity sets up an 'anim' fall; when it ends we call resolveStep again
    }

    // compute target positions and create a fall animation; gems above gaps
    // drop down, empty cells at top spawn new gems falling in from above.
    function applyGravity() {
      // falling[r][c] = {fromY offset in cells} for animating
      const moving = []   // {r,c,type, startY (px), endY (px)}
      for (let c = 0; c < COLS; c++) {
        // collect existing gems bottom-up
        const colTypes = []
        for (let r = ROWS - 1; r >= 0; r--) {
          if (grid[r][c] !== -1) colTypes.push(grid[r][c])
        }
        // place from bottom; remember old rows for animation distance
        // first record where each gem currently is (bottom-up)
        const oldRows = []
        for (let r = ROWS - 1; r >= 0; r--) {
          if (grid[r][c] !== -1) oldRows.push(r)
        }
        // clear column
        for (let r = 0; r < ROWS; r++) grid[r][c] = -1
        // settle existing gems at bottom
        let writeRow = ROWS - 1
        for (let i = 0; i < colTypes.length; i++) {
          const t = colTypes[i]
          const fromR = oldRows[i]
          grid[writeRow][c] = t
          if (fromR !== writeRow) {
            moving.push({
              r: writeRow, c, type: t,
              startY: TOP + fromR * CELL,
              endY: TOP + writeRow * CELL,
            })
          }
          writeRow--
        }
        // fill the rest (top) with new gems falling from above the board
        let spawnIdx = 0
        for (let r = writeRow; r >= 0; r--) {
          const t = randType()
          grid[r][c] = t
          moving.push({
            r, c, type: t,
            startY: TOP - (spawnIdx + 1) * CELL,
            endY: TOP + r * CELL,
          })
          spawnIdx++
        }
      }

      if (moving.length === 0) {
        // nothing fell (shouldn't happen after a clear, but be safe)
        resolveStep()
        return
      }
      // animation progresses by px; track per-gem offset = current - end
      let maxDist = 0
      for (const m of moving) maxDist = Math.max(maxDist, m.endY - m.startY)
      const dur = (maxDist / CELL) / FALL_SPEED
      anim = { kind: 'fall', moving, t: 0, dur: Math.max(0.08, dur) }
      phase = 'resolve'
    }

    function reshuffle() {
      // gather current types, shuffle, refill ensuring a move exists & no match
      const types = []
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) types.push(grid[r][c])
      let tries = 0
      do {
        // Fisher-Yates
        for (let i = types.length - 1; i > 0; i--) {
          const j = (Math.random() * (i + 1)) | 0
          const tmp = types[i]; types[i] = types[j]; types[j] = tmp
        }
        let idx = 0
        for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) grid[r][c] = types[idx++]
        tries++
        if (tries > 60) { buildBoard(); break } // give up: fresh board
      } while (findMatches(grid).size > 0 || !hasMove())
      phase = 'idle'
    }

    function endGame() {
      state = 'over'
      if (score > best) { best = score; localStorage.setItem(BEST_KEY, String(best)) }
      if (auto && !recorded) {
        recorded = true
        recordAutoplayResult('match-3', score >= WIN_SCORE)
      }
    }

    // begin a swap attempt between two adjacent cells
    function trySwap(a, b) {
      if (phase !== 'idle' || state !== 'playing') return
      const adj = (Math.abs(a.r - b.r) + Math.abs(a.c - b.c)) === 1
      if (!adj) { selected = b; return }
      const valid = swapMakesMatch(a.r, a.c, b.r, b.c)
      anim = {
        kind: valid ? 'swap' : 'reject',
        a, b, t: 0, dur: SWAP_DUR,
        ta: grid[a.r][a.c], tb: grid[b.r][b.c],
        valid,
      }
      phase = valid ? 'swap' : 'reject'
      selected = null
    }

    // --- update ---
    function update(dt) {
      // particles always update
      for (const p of particles) {
        p.t += dt
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.vy += 280 * dt
      }
      particles = particles.filter((p) => p.t < p.life)
      if (flash) { flash.t += dt; if (flash.t > 0.25) flash = null }

      if (!anim) return
      anim.t += dt
      const done = anim.t >= anim.dur

      if (anim.kind === 'swap') {
        if (done) {
          // commit swap, consume a move, start resolving
          const { a, b } = anim
          const t = grid[a.r][a.c]
          grid[a.r][a.c] = grid[b.r][b.c]
          grid[b.r][b.c] = t
          anim = null
          moves -= 1
          combo = 0
          resolveStep()
        }
      } else if (anim.kind === 'reject') {
        // goes forward then back; finishes with no grid change
        if (anim.t >= anim.dur * 2) {
          anim = null
          phase = 'idle'
        }
      } else if (anim.kind === 'fall') {
        if (done) {
          anim = null
          resolveStep()
        }
      }
    }

    // --- input ---
    function pointFromEvent(e) {
      const rect = canvas.getBoundingClientRect()
      const x = (e.clientX - rect.left) * (W / rect.width)
      const y = (e.clientY - rect.top) * (H / rect.height)
      return { x, y }
    }

    let dragStart = null
    function onPointerDown(e) {
      if (state === 'over') { newGame(); return }
      if (phase !== 'idle' || state !== 'playing') return
      const { x, y } = pointFromEvent(e)
      const cell = cellAt(x, y)
      if (!cell) { selected = null; return }
      dragStart = { ...cell, x, y }
      if (selected && (Math.abs(selected.r - cell.r) + Math.abs(selected.c - cell.c)) === 1) {
        trySwap(selected, cell)
      } else if (selected && selected.r === cell.r && selected.c === cell.c) {
        selected = null
      } else {
        selected = cell
      }
    }
    function onPointerUp(e) {
      if (!dragStart || phase !== 'idle' || state !== 'playing') { dragStart = null; return }
      const { x, y } = pointFromEvent(e)
      const dx = x - dragStart.x, dy = y - dragStart.y
      const dist = Math.hypot(dx, dy)
      if (dist > CELL * 0.4) {
        // directional drag -> swap with neighbor
        let nr = dragStart.r, nc = dragStart.c
        if (Math.abs(dx) > Math.abs(dy)) nc += dx > 0 ? 1 : -1
        else nr += dy > 0 ? 1 : -1
        if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) {
          trySwap({ r: dragStart.r, c: dragStart.c }, { r: nr, c: nc })
        }
      }
      dragStart = null
    }
    function onKeyDown(e) {
      if (e.code === 'Space') {
        e.preventDefault()
        if (state === 'over') newGame()
      }
    }
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointerup', onPointerUp)
    window.addEventListener('keydown', onKeyDown)

    // --- drawing ---
    function sparkle(x, y, s) {
      ctx.strokeStyle = PINK; ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(x - s, y); ctx.lineTo(x + s, y)
      ctx.moveTo(x, y - s); ctx.lineTo(x, y + s)
      ctx.stroke()
    }

    function label(x, y, text, value, align) {
      ctx.textAlign = align || 'left'
      ctx.fillStyle = PINK; ctx.font = '700 11px system-ui, sans-serif'
      ctx.fillText(text, x, y)
      const bw = 22
      const bx = align === 'right' ? x - bw : (align === 'center' ? x - bw / 2 : x)
      ctx.fillRect(bx, y + 4, bw, 3)
      ctx.fillStyle = '#fff'; ctx.font = '800 20px system-ui, sans-serif'
      ctx.fillText(String(value), x, y + 28)
    }

    // draw a single gem; each type gets a distinct shape too (color-blind aid)
    function gem(cx, cy, type, glow) {
      const color = COLORS[type]
      const rad = CELL / 2 - PAD
      if (glow) { ctx.shadowColor = color; ctx.shadowBlur = 20 } else { ctx.shadowColor = color; ctx.shadowBlur = 6 }
      ctx.fillStyle = color
      ctx.beginPath()
      drawShape(cx, cy, rad, type)
      ctx.fill()
      ctx.shadowBlur = 0
      // glossy overlay (same shape clipped)
      ctx.save()
      ctx.beginPath()
      drawShape(cx, cy, rad, type)
      ctx.clip()
      const g = ctx.createRadialGradient(cx - rad * 0.35, cy - rad * 0.4, rad * 0.1, cx, cy, rad * 1.1)
      g.addColorStop(0, 'rgba(255,255,255,0.6)')
      g.addColorStop(0.4, 'rgba(255,255,255,0.06)')
      g.addColorStop(1, 'rgba(0,0,0,0.22)')
      ctx.fillStyle = g
      ctx.fillRect(cx - rad - 4, cy - rad - 4, rad * 2 + 8, rad * 2 + 8)
      ctx.restore()
      // highlight dot
      ctx.fillStyle = 'rgba(255,255,255,0.85)'
      ctx.beginPath(); ctx.arc(cx - rad * 0.3, cy - rad * 0.32, rad * 0.16, 0, Math.PI * 2); ctx.fill()
    }

    // 6 distinct silhouettes
    function drawShape(cx, cy, r, type) {
      switch (type) {
        case 0: { // pink: rounded square
          const k = r * 0.9, rr = r * 0.35
          roundRect(cx - k, cy - k, k * 2, k * 2, rr)
          break
        }
        case 1: { // cyan: diamond
          ctx.moveTo(cx, cy - r)
          ctx.lineTo(cx + r, cy)
          ctx.lineTo(cx, cy + r)
          ctx.lineTo(cx - r, cy)
          ctx.closePath()
          break
        }
        case 2: { // purple: hexagon
          for (let i = 0; i < 6; i++) {
            const a = Math.PI / 6 + i * Math.PI / 3
            const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
          }
          ctx.closePath()
          break
        }
        case 3: { // green: circle
          ctx.arc(cx, cy, r, 0, Math.PI * 2)
          break
        }
        case 4: { // yellow: 5-point star
          star(cx, cy, r, r * 0.48, 5)
          break
        }
        case 5: { // orange: triangle
          ctx.moveTo(cx, cy - r)
          ctx.lineTo(cx + r * 0.92, cy + r * 0.7)
          ctx.lineTo(cx - r * 0.92, cy + r * 0.7)
          ctx.closePath()
          break
        }
        default: ctx.arc(cx, cy, r, 0, Math.PI * 2)
      }
    }
    function roundRect(x, y, w, h, r) {
      ctx.moveTo(x + r, y)
      ctx.arcTo(x + w, y, x + w, y + h, r)
      ctx.arcTo(x + w, y + h, x, y + h, r)
      ctx.arcTo(x, y + h, x, y, r)
      ctx.arcTo(x, y, x + w, y, r)
      ctx.closePath()
    }
    function star(cx, cy, outer, inner, points) {
      for (let i = 0; i < points * 2; i++) {
        const r = i % 2 === 0 ? outer : inner
        const a = -Math.PI / 2 + i * Math.PI / points
        const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
      }
      ctx.closePath()
    }

    function draw() {
      ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, W, H)
      sparkle(22, 24, 5); sparkle(W - 22, 24, 4)

      // HUD
      label(14, 24, 'SCORE', score, 'left')
      label(W / 2, 24, 'MOVES', moves, 'center')
      label(W - 14, 24, 'BEST', best, 'right')

      // board background grid cells
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const { x, y } = cellRect(r, c)
          ctx.fillStyle = (r + c) % 2 === 0 ? 'rgba(255,255,255,0.025)' : 'rgba(255,255,255,0.05)'
          ctx.fillRect(x, y, CELL, CELL)
        }
      }

      // figure out which cells are mid-animation so we skip their static draw
      const skip = new Set()
      let swapDraw = null
      if (anim && anim.kind === 'fall') {
        const p = Math.min(1, anim.t / anim.dur)
        // ease-out
        const e = 1 - (1 - p) * (1 - p)
        for (const m of anim.moving) {
          skip.add(key(m.r, m.c))
          const y = m.startY + (m.endY - m.startY) * e
          const { x } = cellRect(m.r, m.c)
          gem(x + CELL / 2, y + CELL / 2, m.type, false)
        }
      } else if (anim && (anim.kind === 'swap' || anim.kind === 'reject')) {
        skip.add(key(anim.a.r, anim.a.c))
        skip.add(key(anim.b.r, anim.b.c))
        let p
        if (anim.kind === 'swap') {
          p = Math.min(1, anim.t / anim.dur)
        } else {
          // reject: 0->1 then 1->0
          const half = anim.t / anim.dur
          p = half <= 1 ? half : Math.max(0, 2 - half)
        }
        const ar = cellRect(anim.a.r, anim.a.c)
        const br = cellRect(anim.b.r, anim.b.c)
        // a moves toward b, b moves toward a
        const ax = ar.x + (br.x - ar.x) * p, ay = ar.y + (br.y - ar.y) * p
        const bx = br.x + (ar.x - br.x) * p, by = br.y + (ar.y - br.y) * p
        gem(ax + CELL / 2, ay + CELL / 2, anim.ta, false)
        gem(bx + CELL / 2, by + CELL / 2, anim.tb, false)
        swapDraw = true
      }

      // static gems
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          if (skip.has(key(r, c))) continue
          const t = grid[r][c]
          if (t === -1) continue
          const { x, y } = cellRect(r, c)
          const glow = flash && flash.cells.has(key(r, c))
          gem(x + CELL / 2, y + CELL / 2, t, glow)
        }
      }

      // selection highlight
      if (selected && state === 'playing') {
        const { x, y } = cellRect(selected.r, selected.c)
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 3
        ctx.shadowColor = PINK; ctx.shadowBlur = 14
        roundRectStroke(x + 2, y + 2, CELL - 4, CELL - 4, 8)
        ctx.shadowBlur = 0
      }

      // particles
      for (const p of particles) {
        const a = 1 - p.t / p.life
        ctx.globalAlpha = Math.max(0, a)
        ctx.fillStyle = p.color
        ctx.beginPath(); ctx.arc(p.x, p.y, 2 + a * 3, 0, Math.PI * 2); ctx.fill()
      }
      ctx.globalAlpha = 1

      // combo banner during a cascade chain
      if (combo >= 2 && phase === 'resolve') {
        ctx.textAlign = 'center'
        ctx.fillStyle = PINK; ctx.font = '800 22px system-ui, sans-serif'
        ctx.shadowColor = PINK; ctx.shadowBlur = 16
        ctx.fillText('COMBO x' + combo, W / 2, TOP + ROWS * CELL / 2)
        ctx.shadowBlur = 0
      }

      if (state === 'over') {
        ctx.fillStyle = 'rgba(10,10,10,0.82)'; ctx.fillRect(0, H / 2 - 78, W, 156)
        ctx.textAlign = 'center'
        ctx.fillStyle = PINK; ctx.font = '800 34px system-ui, sans-serif'
        ctx.fillText('GAME OVER', W / 2, H / 2 - 18)
        ctx.fillStyle = PINK; ctx.fillRect(W / 2 - 64, H / 2 - 4, 128, 4)
        ctx.fillStyle = '#fff'; ctx.font = '700 16px system-ui, sans-serif'
        ctx.fillText('Score ' + score, W / 2, H / 2 + 24)
        ctx.fillStyle = MUTED; ctx.font = '600 13px system-ui, sans-serif'
        ctx.fillText('space / tap to play again', W / 2, H / 2 + 48)
      }
    }

    function roundRectStroke(x, y, w, h, r) {
      ctx.beginPath()
      ctx.moveTo(x + r, y)
      ctx.arcTo(x + w, y, x + w, y + h, r)
      ctx.arcTo(x + w, y + h, x, y + h, r)
      ctx.arcTo(x, y + h, x, y, r)
      ctx.arcTo(x, y, x + w, y, r)
      ctx.closePath()
      ctx.stroke()
    }

    function loop(now) {
      let dt = (now - last) / 1000; last = now
      if (dt > 0.05) dt = 0.05
      update(dt)
      draw()
      raf = requestAnimationFrame(loop)
    }

    // --- autoplay bot: drives swaps via the game's own trySwap on a timer ---
    let botTimer = 0
    let wantWin = auto ? shouldAutoWin('match-3') : false   // per-round goal
    let recorded = false                                    // result recorded this round?

    // Score the outcome of a swap by simulating the full clear+gravity+cascade
    // chain on a copy of the grid. Returns a heuristic value that rewards big
    // matches and cascades, so the bot prefers 4/5-clears and chain reactions.
    // 0 means the swap creates no match (a wasted / swap-back move).
    function evalSwap(r1, c1, r2, c2) {
      // deep copy
      const g = grid.map((row) => row.slice())
      const t = g[r1][c1]; g[r1][c1] = g[r2][c2]; g[r2][c2] = t
      let value = 0, chain = 0
      for (;;) {
        const m = findMatches(g)
        if (m.size === 0) break
        chain += 1
        let v = m.size * 30
        if (m.size >= 5) v += 120
        else if (m.size === 4) v += 50
        value += v * chain          // escalating combo multiplier, like real scoring
        for (const cell of m) {
          const [r, c] = cell.split(',').map(Number)
          g[r][c] = -1
        }
        // simulate gravity per column (no animation, just settle + refill random)
        for (let c = 0; c < COLS; c++) {
          const stack = []
          for (let r = ROWS - 1; r >= 0; r--) if (g[r][c] !== -1) stack.push(g[r][c])
          let wr = ROWS - 1
          for (let i = 0; i < stack.length; i++) g[wr--][c] = stack[i]
          for (let r = wr; r >= 0; r--) g[r][c] = randType()
        }
      }
      return value
    }

    // find the swap with the highest simulated value (prefers 4/5+ clears and
    // cascades). Returns null only if no swap produces any match.
    function findBestSwap() {
      let best = null, bestVal = 0
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          if (c + 1 < COLS) {
            const v = evalSwap(r, c, r, c + 1)
            if (v > bestVal) { bestVal = v; best = [{ r, c }, { r, c: c + 1 }] }
          }
          if (r + 1 < ROWS) {
            const v = evalSwap(r, c, r + 1, c)
            if (v > bestVal) { bestVal = v; best = [{ r, c }, { r: r + 1, c }] }
          }
        }
      }
      return best
    }

    // a random adjacent swap (may swap back / waste a move — fine for sloppy play).
    function findRandomSwap() {
      const r = (Math.random() * ROWS) | 0
      const c = (Math.random() * COLS) | 0
      const horiz = Math.random() < 0.5
      if (horiz && c + 1 < COLS) return [{ r, c }, { r, c: c + 1 }]
      if (!horiz && r + 1 < ROWS) return [{ r, c }, { r: r + 1, c }]
      if (c + 1 < COLS) return [{ r, c }, { r, c: c + 1 }]
      return [{ r, c }, { r: r + 1, c }]
    }

    function botTick() {
      if (state === 'over') {
        // restart ~1.5s after the round ends, picking a fresh goal for the next one
        botTimer = window.setTimeout(() => {
          newGame()
          wantWin = shouldAutoWin('match-3')
          recorded = false
          scheduleBot()
        }, 1500)
        return
      }
      // only act when the board is fully idle (no swap/fall/cascade animating)
      if (phase === 'idle' && state === 'playing' && !anim) {
        if (wantWin) {
          // greedy: always play the best scoring swap, never a swap-back.
          const move = findBestSwap()
          if (move) trySwap(move[0], move[1])
          // if somehow none (dead board), the game reshuffles on resolve; re-poll.
        } else {
          // sloppy: random swaps that often waste the move -> low score.
          const move = findRandomSwap()
          if (move) trySwap(move[0], move[1])
        }
      }
      scheduleBot()
    }

    function scheduleBot() {
      // act only when the board is idle/not animating; otherwise re-poll soon
      // for smooth, watchable pacing.
      const ready = (phase === 'idle' && !anim) || state === 'over'
      const delay = ready ? (520 + Math.random() * 260) : 110
      botTimer = window.setTimeout(botTick, delay)
    }

    newGame()
    raf = requestAnimationFrame(loop)
    if (auto) scheduleBot()

    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(botTimer)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  return (
    <canvas ref={canvasRef} width={W} height={H} className="match3-canvas" aria-label="Match-3 game" />
  )
}
