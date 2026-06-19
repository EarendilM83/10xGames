import { useEffect, useRef } from 'react'
import { isAutoplay, shouldAutoWin, recordAutoplayResult } from '../autoplay.js'

// Bubble Shooter (Puzzle-Bobble style) on canvas, 10x neon style.
// Hex grid (offset rows), aim with mouse/← →, fire with click/Space.
const W = 460
const H = 600

const R = 19                 // bubble radius
const D = R * 2              // bubble diameter (cell width)
const COLS = Math.floor(W / D) // bubbles per even row
const ROW_H = R * Math.sqrt(3) // vertical step between rows
const TOP = 56               // grid top offset (below HUD)
const START_ROWS = 6
const LOSE_Y = H - 96        // settle below this -> lose
const SHOT_SPEED = 560       // px/s
const PUSH_EVERY = 8         // shots between ceiling pushes
const WIN_SCORE = 300        // autoplay success threshold (or board cleared)

const PINK = '#ff2d6f'
const MUTED = '#8a93ad'
const COLORS = ['#ff2d6f', '#2de2e6', '#b14aed', '#54e346', '#ffd60a']

const BEST_KEY = '10xgames.bubble.best'

export default function BubbleShooter() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')

    const auto = isAutoplay('bubble-shooter')

    // grid[row] = array of cells; cell = color string or null
    let grid, shooter, current, next, flying, particles
    let score, best, state, aim, shotsFired, pushOffset
    const keys = { left: false, right: false }
    let last = performance.now(), raf = 0
    let pointerAngle = -Math.PI / 2

    best = Number(localStorage.getItem(BEST_KEY)) || 0

    // ---- hex grid helpers ----
    // even rows (0,2,..): COLS cells starting at x = R
    // odd rows: COLS-1 cells starting at x = R + R (shifted half a bubble)
    const rowCols = (r) => ((r + pushOffset) % 2 === 0 ? COLS : COLS - 1)
    function cellCenter(r, c) {
      const odd = (r + pushOffset) % 2 !== 0
      const x = R + c * D + (odd ? R : 0)
      const y = TOP + r * ROW_H
      return { x, y }
    }
    // neighbors depend on row parity (relative to pushOffset)
    function neighbors(r, c) {
      const odd = (r + pushOffset) % 2 !== 0
      const list = [
        [r, c - 1], [r, c + 1],
      ]
      if (odd) {
        list.push([r - 1, c], [r - 1, c + 1], [r + 1, c], [r + 1, c + 1])
      } else {
        list.push([r - 1, c - 1], [r - 1, c], [r + 1, c - 1], [r + 1, c])
      }
      return list.filter(([rr, cc]) => rr >= 0 && rr < grid.length && cc >= 0 && cc < rowCols(rr))
    }

    function colorsInPlay() {
      const set = new Set()
      for (const row of grid) for (const cell of row) if (cell) set.add(cell)
      return [...set]
    }
    function randColor() {
      const inPlay = colorsInPlay()
      const pool = inPlay.length ? inPlay : COLORS
      return pool[(Math.random() * pool.length) | 0]
    }

    function ensureRows() {
      // make sure grid has at least a couple empty rows below the lowest bubble
      while (grid.length < 14) grid.push(new Array(rowCols(grid.length)).fill(null))
    }

    function newGame() {
      grid = []
      pushOffset = 0
      for (let r = 0; r < START_ROWS; r++) {
        const arr = []
        for (let c = 0; c < ((r % 2 === 0) ? COLS : COLS - 1); c++) {
          arr.push(COLORS[(Math.random() * COLORS.length) | 0])
        }
        grid.push(arr)
      }
      ensureRows()
      score = 0
      shotsFired = 0
      flying = null
      particles = []
      shooter = { x: W / 2, y: H - 44 }
      current = COLORS[(Math.random() * COLORS.length) | 0]
      next = randColor()
      state = 'ready'
    }

    function startGame() { state = 'playing' }

    function fire() {
      if (flying) return
      const angle = pointerAngle
      flying = {
        x: shooter.x, y: shooter.y,
        vx: Math.cos(angle) * SHOT_SPEED,
        vy: Math.sin(angle) * SHOT_SPEED,
        color: current,
      }
      current = next
      next = randColor()
      shotsFired++
    }

    function loadNextAfterSettle() {
      if (shotsFired > 0 && shotsFired % PUSH_EVERY === 0) pushDown()
    }

    function pushDown() {
      // insert a new full row at the top, shifting parity
      pushOffset = (pushOffset + 1) % 2
      const newRow = []
      for (let c = 0; c < rowCols(0); c++) newRow.push(COLORS[(Math.random() * COLORS.length) | 0])
      grid.unshift(newRow)
      ensureRows()
      checkLose()
    }

    // find nearest empty cell near a world position
    function snapTo(x, y) {
      ensureRows()
      let bestCell = null, bestDist = Infinity
      for (let r = 0; r < grid.length; r++) {
        for (let c = 0; c < rowCols(r); c++) {
          if (grid[r][c]) continue
          const ct = cellCenter(r, c)
          const d = (ct.x - x) ** 2 + (ct.y - y) ** 2
          if (d < bestDist) { bestDist = d; bestCell = [r, c] }
        }
      }
      return bestCell
    }

    function popCluster(r, c, color) {
      // flood-fill same-color connected cluster including (r,c)
      const visited = new Set()
      const stack = [[r, c]]
      const cluster = []
      visited.add(r + ',' + c)
      while (stack.length) {
        const [cr, cc] = stack.pop()
        if (grid[cr][cc] !== color) continue
        cluster.push([cr, cc])
        for (const [nr, nc] of neighbors(cr, cc)) {
          const key = nr + ',' + nc
          if (!visited.has(key) && grid[nr][nc] === color) {
            visited.add(key)
            stack.push([nr, nc])
          }
        }
      }
      return cluster
    }

    function dropFloating() {
      // any bubble NOT connected to row 0 (ceiling) is floating -> drop
      const visited = new Set()
      const stack = []
      for (let c = 0; c < rowCols(0); c++) {
        if (grid[0][c]) { stack.push([0, c]); visited.add('0,' + c) }
      }
      while (stack.length) {
        const [r, c] = stack.pop()
        for (const [nr, nc] of neighbors(r, c)) {
          const key = nr + ',' + nc
          if (!visited.has(key) && grid[nr][nc]) {
            visited.add(key)
            stack.push([nr, nc])
          }
        }
      }
      let dropped = 0
      for (let r = 0; r < grid.length; r++) {
        for (let c = 0; c < rowCols(r); c++) {
          if (grid[r][c] && !visited.has(r + ',' + c)) {
            spawnPop(cellCenter(r, c), grid[r][c])
            grid[r][c] = null
            dropped++
          }
        }
      }
      return dropped
    }

    function spawnPop(pos, color) {
      for (let i = 0; i < 8; i++) {
        const a = Math.random() * Math.PI * 2
        const sp = 60 + Math.random() * 140
        particles.push({
          x: pos.x, y: pos.y,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          life: 0.5 + Math.random() * 0.3, t: 0, color,
        })
      }
    }

    function checkWin() {
      for (const row of grid) for (const cell of row) if (cell) return false
      return true
    }

    function checkLose() {
      for (let r = 0; r < grid.length; r++) {
        for (let c = 0; c < rowCols(r); c++) {
          if (grid[r][c] && cellCenter(r, c).y + R >= LOSE_Y) return true
        }
      }
      return false
    }

    function endGame(won) {
      state = won ? 'win' : 'over'
      if (score > best) { best = score; localStorage.setItem(BEST_KEY, String(best)) }
      if (auto) {
        const success = won || score >= WIN_SCORE
        recordAutoplayResult('bubble-shooter', success)
      }
    }

    function settle() {
      const cell = snapTo(flying.x, flying.y)
      if (!cell) { flying = null; return }
      const [r, c] = cell
      grid[r][c] = flying.color
      const color = flying.color
      flying = null

      const cluster = popCluster(r, c, color)
      if (cluster.length >= 3) {
        for (const [cr, cc] of cluster) {
          spawnPop(cellCenter(cr, cc), grid[cr][cc])
          grid[cr][cc] = null
          score += 10
        }
        const dropped = dropFloating()
        score += dropped * 20
      }

      if (checkWin()) { endGame(true); return }
      if (checkLose()) { endGame(false); return }
      loadNextAfterSettle()
      if (checkLose()) { endGame(false); return }
    }

    function update(dt) {
      // aim from keyboard
      if (keys.left) pointerAngle -= 2.4 * dt
      if (keys.right) pointerAngle += 2.4 * dt
      // clamp aim so it always points upward-ish
      const minA = -Math.PI + 0.25, maxA = -0.25
      if (pointerAngle < minA) pointerAngle = minA
      if (pointerAngle > maxA) pointerAngle = maxA

      // particles
      for (const p of particles) {
        p.t += dt
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.vy += 320 * dt
      }
      particles = particles.filter((p) => p.t < p.life)

      if (state !== 'playing') return

      if (flying) {
        flying.x += flying.vx * dt
        flying.y += flying.vy * dt
        // walls
        if (flying.x - R < 0) { flying.x = R; flying.vx = Math.abs(flying.vx) }
        if (flying.x + R > W) { flying.x = W - R; flying.vx = -Math.abs(flying.vx) }
        // ceiling
        if (flying.y - R <= TOP - ROW_H * 0.5) { settle(); return }
        // collision with any bubble
        for (let r = 0; r < grid.length; r++) {
          for (let c = 0; c < rowCols(r); c++) {
            if (!grid[r][c]) continue
            const ct = cellCenter(r, c)
            if ((ct.x - flying.x) ** 2 + (ct.y - flying.y) ** 2 <= (D * 0.92) ** 2) {
              settle()
              return
            }
          }
        }
      }
    }

    // ---------- input ----------
    function onKeyDown(e) {
      const k = e.code
      if (k === 'ArrowLeft') { keys.left = true; e.preventDefault() }
      else if (k === 'ArrowRight') { keys.right = true; e.preventDefault() }
      else if (k === 'Space') {
        e.preventDefault()
        if (state === 'ready') startGame()
        else if (state === 'over' || state === 'win') newGame()
        else if (state === 'playing') fire()
      }
    }
    function onKeyUp(e) {
      if (e.code === 'ArrowLeft') keys.left = false
      else if (e.code === 'ArrowRight') keys.right = false
    }
    function aimAt(clientX, clientY) {
      const rect = canvas.getBoundingClientRect()
      const x = (clientX - rect.left) * (W / rect.width)
      const y = (clientY - rect.top) * (H / rect.height)
      let a = Math.atan2(y - shooter.y, x - shooter.x)
      const minA = -Math.PI + 0.25, maxA = -0.25
      if (a > 0) a = maxA // pointing downward -> clamp
      pointerAngle = Math.max(minA, Math.min(maxA, a))
    }
    function onPointerMove(e) { aimAt(e.clientX, e.clientY) }
    function onPointerDown(e) {
      if (state === 'ready') { startGame(); return }
      if (state === 'over' || state === 'win') { newGame(); return }
      aimAt(e.clientX, e.clientY)
      fire()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerdown', onPointerDown)

    // ---------- drawing ----------
    function sparkle(x, y, s) {
      ctx.strokeStyle = PINK; ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(x - s, y); ctx.lineTo(x + s, y); ctx.moveTo(x, y - s); ctx.lineTo(x, y + s); ctx.stroke()
    }
    function bubble(x, y, color, rad) {
      const r = rad || R
      ctx.shadowColor = color; ctx.shadowBlur = 12
      ctx.fillStyle = color
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
      ctx.shadowBlur = 0
      // glossy gradient
      const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r)
      g.addColorStop(0, 'rgba(255,255,255,0.55)')
      g.addColorStop(0.4, 'rgba(255,255,255,0.05)')
      g.addColorStop(1, 'rgba(0,0,0,0.18)')
      ctx.fillStyle = g
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
      // highlight dot
      ctx.fillStyle = 'rgba(255,255,255,0.85)'
      ctx.beginPath(); ctx.arc(x - r * 0.32, y - r * 0.34, r * 0.18, 0, Math.PI * 2); ctx.fill()
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

    function draw() {
      ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, W, H)
      sparkle(24, 26, 5); sparkle(W - 24, H - 24, 4)

      // HUD
      label(16, 24, 'SCORE', score, 'left')
      label(W - 16, 24, 'BEST', best, 'right')

      // next bubble preview
      ctx.fillStyle = MUTED; ctx.font = '700 10px system-ui, sans-serif'; ctx.textAlign = 'center'
      ctx.fillText('NEXT', W / 2, 18)
      bubble(W / 2, 34, next, 11)

      // lose line
      ctx.strokeStyle = 'rgba(255,45,111,0.4)'; ctx.lineWidth = 2; ctx.setLineDash([6, 6])
      ctx.beginPath(); ctx.moveTo(0, LOSE_Y); ctx.lineTo(W, LOSE_Y); ctx.stroke()
      ctx.setLineDash([])

      // grid bubbles
      for (let r = 0; r < grid.length; r++) {
        for (let c = 0; c < rowCols(r); c++) {
          if (grid[r][c]) {
            const ct = cellCenter(r, c)
            bubble(ct.x, ct.y, grid[r][c])
          }
        }
      }

      // aim line (dotted pink) when playing
      if (state === 'playing' && !flying) {
        ctx.strokeStyle = PINK; ctx.lineWidth = 2; ctx.setLineDash([3, 7]); ctx.globalAlpha = 0.85
        ctx.beginPath()
        ctx.moveTo(shooter.x, shooter.y)
        ctx.lineTo(shooter.x + Math.cos(pointerAngle) * 220, shooter.y + Math.sin(pointerAngle) * 220)
        ctx.stroke()
        ctx.setLineDash([]); ctx.globalAlpha = 1
      }

      // shooter base + current bubble
      ctx.fillStyle = 'rgba(177,74,237,0.25)'
      ctx.beginPath(); ctx.arc(shooter.x, shooter.y, R + 7, 0, Math.PI * 2); ctx.fill()
      if (!flying) bubble(shooter.x, shooter.y, current)

      // flying bubble
      if (flying) bubble(flying.x, flying.y, flying.color)

      // particles
      for (const p of particles) {
        const a = 1 - p.t / p.life
        ctx.globalAlpha = Math.max(0, a)
        ctx.fillStyle = p.color
        ctx.beginPath(); ctx.arc(p.x, p.y, 3 + a * 3, 0, Math.PI * 2); ctx.fill()
      }
      ctx.globalAlpha = 1

      // footer hint
      ctx.fillStyle = MUTED; ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'center'
      ctx.fillText('aim: mouse / ← →   ·   fire: click / space', W / 2, H - 12)

      if (state === 'ready') overlay('BUBBLE SHOOTER', 'space / tap to start')
      else if (state === 'over') overlay('GAME OVER', 'space / tap to play again')
      else if (state === 'win') overlay('CLEARED!', 'space / tap to play again')
    }

    function overlay(title, sub) {
      ctx.fillStyle = 'rgba(10,10,10,0.8)'; ctx.fillRect(0, H / 2 - 70, W, 140)
      ctx.textAlign = 'center'
      ctx.fillStyle = PINK; ctx.font = '800 34px system-ui, sans-serif'
      ctx.fillText(title, W / 2, H / 2)
      ctx.fillStyle = PINK; ctx.fillRect(W / 2 - 64, H / 2 + 12, 128, 4)
      ctx.fillStyle = '#fff'; ctx.font = '600 14px system-ui, sans-serif'
      ctx.fillText(sub, W / 2, H / 2 + 42)
    }

    // ---------- autoplay bot ----------
    // Drives the game's own aim state (pointerAngle) + fire() on a timer.
    // wantWin rounds aim at a same-color grid bubble to build/clear clusters;
    // sloppy rounds aim randomly so mismatched bubbles pile up and reach LOSE_Y.
    let botWantWin = shouldAutoWin('bubble-shooter')
    let botNextShot = 0          // timestamp gate between shots
    let botRestartAt = 0         // scheduled auto-restart timestamp

    // Simulate where a shot fired at `angle` (with the current bubble color)
    // would settle, and return the resulting same-color cluster size at that
    // landing cell. Pure read-only: never mutates the real grid.
    function simulateShot(angle) {
      let x = shooter.x, y = shooter.y
      let vx = Math.cos(angle) * SHOT_SPEED, vy = Math.sin(angle) * SHOT_SPEED
      const step = 1 / 240
      for (let i = 0; i < 1200; i++) {
        x += vx * step; y += vy * step
        if (x - R < 0) { x = R; vx = Math.abs(vx) }
        if (x + R > W) { x = W - R; vx = -Math.abs(vx) }
        if (y - R <= TOP - ROW_H * 0.5) break
        let hit = false
        for (let r = 0; r < grid.length && !hit; r++) {
          for (let c = 0; c < rowCols(r); c++) {
            if (!grid[r][c]) continue
            const ct = cellCenter(r, c)
            if ((ct.x - x) ** 2 + (ct.y - y) ** 2 <= (D * 0.92) ** 2) { hit = true; break }
          }
        }
        if (hit) break
      }
      const cell = snapTo(x, y)
      if (!cell) return { cell: null, cluster: 0 }
      const [r, c] = cell
      // count same-color neighbors-cluster that would form including this cell
      const color = current
      const visited = new Set([r + ',' + c])
      const stack = [[r, c]]
      let size = 1
      while (stack.length) {
        const [cr, cc] = stack.pop()
        for (const [nr, nc] of neighbors(cr, cc)) {
          const key = nr + ',' + nc
          if (!visited.has(key) && grid[nr][nc] === color) {
            visited.add(key); stack.push([nr, nc]); size++
          }
        }
      }
      return { cell, cluster: size }
    }

    function botPickAngle() {
      const minA = -Math.PI + 0.25, maxA = -0.25
      if (botWantWin) {
        // Sweep aim angles, simulate each, prefer the shot that forms the
        // largest 3+ cluster (a pop). Smooth deterministic search, no spray.
        let bestAngle = null, bestScore = -1
        const steps = 90
        for (let i = 0; i <= steps; i++) {
          const a = minA + (i / steps) * (maxA - minA)
          const { cell, cluster } = simulateShot(a)
          if (!cell) continue
          const [r] = cell
          // score: popping (3+) is best, weighted by size; otherwise prefer
          // landing high (low row) so the board stays controlled.
          let s
          if (cluster >= 3) s = 1000 + cluster * 10 - r
          else s = 100 - r * 2 - cluster // avoid building toward a stuck pile
          if (s > bestScore) { bestScore = s; bestAngle = a }
        }
        if (bestAngle !== null) return bestAngle
        // fallback: aim at nearest matching bubble
        let target = null, bestD = Infinity
        for (let r = 0; r < grid.length; r++) {
          for (let c = 0; c < rowCols(r); c++) {
            if (grid[r][c] !== current) continue
            const ct = cellCenter(r, c)
            const d = (ct.x - shooter.x) ** 2 + (ct.y - shooter.y) ** 2
            if (d < bestD) { bestD = d; target = ct }
          }
        }
        if (target) {
          const a = Math.atan2(target.y - shooter.y, target.x - shooter.x)
          return Math.max(minA, Math.min(maxA, a))
        }
      }
      // sloppy / lose round: random valid upward angle
      return minA + Math.random() * (maxA - minA)
    }

    function botTick(now) {
      if (state === 'ready') {
        startGame()
        botNextShot = now + 600
        return
      }
      if (state === 'over' || state === 'win') {
        if (!botRestartAt) botRestartAt = now + 1300   // restart ~1.3s later
        else if (now >= botRestartAt) {
          botRestartAt = 0
          botWantWin = shouldAutoWin('bubble-shooter')
          newGame()
        }
        return
      }
      if (state === 'playing') {
        // only fire once the previous bubble has settled
        if (flying) return
        if (now < botNextShot) return
        pointerAngle = botPickAngle()
        fire()
        botNextShot = now + 700
      }
    }

    function loop(now) {
      let dt = (now - last) / 1000; last = now
      if (dt > 0.05) dt = 0.05
      if (auto) botTick(now)
      update(dt)
      draw()
      raf = requestAnimationFrame(loop)
    }

    newGame()
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerdown', onPointerDown)
    }
  }, [])

  return (
    <canvas ref={canvasRef} width={W} height={H} className="bubble-canvas" aria-label="Bubble Shooter game" />
  )
}
