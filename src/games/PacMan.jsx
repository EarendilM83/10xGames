import { useEffect, useRef } from 'react'
import { isAutoplay, shouldAutoWin, recordAutoplayResult } from '../autoplay.js'

// Pac-Man on canvas, 10x neon-on-black style.
// Single useEffect, rAF + delta-time, grid-aligned movement, 4 distinct ghost AIs.

const TILE = 22
const PAD = 16
const HEADER = 44
const GAP = 8

// Maze: '#' wall, '.' pellet, 'o' power pellet, ' ' empty, '-' pen door, 'T' tunnel mouth (empty)
// 19 cols x 21 rows. Row 9 is the tunnel row (wraps left/right). All rows MUST be equal length.
const MAZE = [
  '###################',
  '#........#........#',
  '#o##.###.#.###.##o#',
  '#.................#',
  '#.##.#.#####.#.##.#',
  '#....#...#...#....#',
  '####.### # ###.####',
  '   #.#   -   #.#   ',
  '####.# ##-## #.####',
  'T......#   #......T',
  '####.# ##### #.####',
  '   #.#       #.#   ',
  '####.# ##### #.####',
  '#........#........#',
  '#.##.###.#.###.##.#',
  '#o.#.....P.....#.o#',
  '##.#.#.#####.#.#.##',
  '#....#...#...#....#',
  '#.######.#.######.#',
  '#.................#',
  '###################',
]

const COLS = MAZE[0].length
const ROWS = MAZE.length
const W = PAD * 2 + COLS * TILE
const H = PAD + HEADER + GAP + ROWS * TILE + PAD
const GRID_X = PAD
const GRID_Y = PAD + HEADER + GAP

const PINK = '#ff2d6f'
const YELLOW = '#ffd60a'
const FRIGHT = '#4d7cff'
const WALL = '#2de2e6'

const HS_KEY = '10xgames.pacman.best'

export default function PacMan() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')

    const auto = isAutoplay('pac-man')

    // ---- static maze grid (chars) parsed once ----
    let grid = MAZE.map((r) => r.split(''))

    // pen / spawn locations (tile coords)
    const PEN = { x: 9, y: 9 } // revive target tile inside pen area
    const DOOR = { x: 9, y: 8 } // tile just above pen exit path

    let pac, ghosts, pellets, score, lives, level, state, best
    let frightTimer = 0
    let phaseTimer = 0
    let mode = 'scatter' // global scatter/chase
    let mouth = 0 // mouth animation phase
    let dotFlash = 0
    best = Number(localStorage.getItem(HS_KEY)) || 0

    let last = performance.now()
    let raf = 0

    function tileChar(tx, ty) {
      if (ty < 0 || ty >= ROWS) return '#'
      // tunnel row wraps; treat out-of-x as open path
      if (tx < 0 || tx >= COLS) return ' '
      return grid[ty][tx]
    }

    function isWall(tx, ty, allowDoor) {
      const c = tileChar(tx, ty)
      if (c === '#') return true
      if (c === '-' && !allowDoor) return true
      return false
    }

    function buildPellets() {
      pellets = 0
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          if (grid[y][x] === '.' || grid[y][x] === 'o') pellets++
        }
      }
    }

    function findChar(ch) {
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) if (MAZE[y][x] === ch) return { x, y }
      }
      return { x: 9, y: 15 }
    }

    function reset(full) {
      if (full) {
        score = 0
        lives = 3
        level = 1
      }
      // restore maze (pellets) — strip the P/T markers into walkable tiles
      grid = MAZE.map((r) =>
        r
          .split('')
          .map((c) => (c === 'P' ? '.' : c === 'T' ? ' ' : c)),
      )
      buildPellets()
      placeActors()
      state = full ? 'ready' : 'ready'
    }

    function placeActors() {
      const start = findChar('P')
      pac = {
        x: start.x,
        y: start.y,
        dir: { x: -1, y: 0 },
        next: { x: -1, y: 0 },
        // pixel position is derived: keep fractional tile progress
        px: start.x,
        py: start.y,
        speed: 5.2 + (level - 1) * 0.5, // tiles per second
      }
      const base = {
        px: 0,
        py: 0,
        dir: { x: 0, y: -1 },
        frightened: false,
        eaten: false,
        speed: 4.8 + (level - 1) * 0.45,
      }
      ghosts = [
        { ...base, name: 'blinky', color: '#ff2d6f', x: 9, y: 7, home: { x: COLS - 2, y: 0 } },
        { ...base, name: 'pinky', color: '#ff9bd2', x: 8, y: 9, home: { x: 1, y: 0 } },
        { ...base, name: 'inky', color: '#2de2e6', x: 9, y: 9, home: { x: COLS - 2, y: ROWS - 1 } },
        { ...base, name: 'clyde', color: '#ff8a1e', x: 10, y: 9, home: { x: 1, y: ROWS - 1 } },
      ]
      ghosts.forEach((g) => {
        g.px = g.x
        g.py = g.y
        g.dir = { x: 0, y: -1 }
        g.next = { x: 0, y: -1 }
        g.frightened = false
        g.eaten = false
      })
      frightTimer = 0
      phaseTimer = 0
      mode = 'scatter'
    }

    // ---------- ghost targeting (the 4 distinct AIs) ----------
    function ghostTarget(g) {
      if (g.eaten) return PEN
      if (g.frightened) return null // frightened uses random
      if (mode === 'scatter') return g.home

      const pt = { x: Math.round(pac.px), y: Math.round(pac.py) }
      const pd = pac.dir

      if (g.name === 'blinky') {
        // chase Pac-Man's current tile directly
        return pt
      }
      if (g.name === 'pinky') {
        // 4 tiles ahead of Pac-Man's facing direction (ambush)
        return { x: pt.x + pd.x * 4, y: pt.y + pd.y * 4 }
      }
      if (g.name === 'inky') {
        // vector from Blinky through a point 2 ahead of Pac, doubled (flank)
        const blinky = ghosts[0]
        const bx = Math.round(blinky.px)
        const by = Math.round(blinky.py)
        const ax = pt.x + pd.x * 2
        const ay = pt.y + pd.y * 2
        return { x: ax + (ax - bx), y: ay + (ay - by) }
      }
      // clyde: chase when far, retreat to corner when within 8 tiles
      const dx = pt.x - Math.round(g.px)
      const dy = pt.y - Math.round(g.py)
      const dist2 = dx * dx + dy * dy
      return dist2 > 64 ? pt : g.home
    }

    const DIRS = [
      { x: 0, y: -1 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 0 },
    ]

    function wrapX(tx) {
      if (tx < 0) return COLS - 1
      if (tx >= COLS) return 0
      return tx
    }

    // choose ghost direction at a tile center
    function chooseGhostDir(g, allowDoor) {
      const cx = Math.round(g.px)
      const cy = Math.round(g.py)
      const target = ghostTarget(g)
      let candidates = []
      for (const d of DIRS) {
        // no reversing (unless dead-end)
        if (d.x === -g.dir.x && d.y === -g.dir.y) continue
        const nx = wrapX(cx + d.x)
        const ny = cy + d.y
        if (isWall(nx, ny, allowDoor || g.eaten)) continue
        candidates.push(d)
      }
      if (candidates.length === 0) {
        // forced reverse (dead end)
        const rev = { x: -g.dir.x, y: -g.dir.y }
        const nx = wrapX(cx + rev.x)
        if (!isWall(nx, cy + rev.y, allowDoor || g.eaten)) return rev
        return g.dir
      }
      if (g.frightened && !g.eaten) {
        // semi-random flee
        return candidates[(Math.random() * candidates.length) | 0]
      }
      // pick candidate minimizing distance to target
      let bestD = candidates[0]
      let bestDist = Infinity
      for (const d of candidates) {
        const nx = cx + d.x
        const ny = cy + d.y
        const ddx = nx - target.x
        const ddy = ny - target.y
        const dist = ddx * ddx + ddy * ddy
        if (dist < bestDist) {
          bestDist = dist
          bestD = d
        }
      }
      return bestD
    }

    // ---------- movement (grid-aligned, fractional pixel pos in tile units) ----------
    function nearCenter(v) {
      return Math.abs(v - Math.round(v)) < 0.05
    }

    function movePac(dt) {
      const step = pac.speed * dt
      const cx = Math.round(pac.px)
      const cy = Math.round(pac.py)

      // try to apply queued direction when aligned and the turn is open
      if (nearCenter(pac.px) && nearCenter(pac.py)) {
        pac.px = cx
        pac.py = cy
        const n = pac.next
        if ((n.x || n.y) && !isWall(wrapX(cx + n.x), cy + n.y, false)) {
          pac.dir = { ...n }
        }
        // stop if wall ahead
        if (isWall(wrapX(cx + pac.dir.x), cy + pac.dir.y, false)) {
          pac.dir = { x: 0, y: 0 }
        }
      }

      pac.px += pac.dir.x * step
      pac.py += pac.dir.y * step
      // tunnel wrap
      if (pac.px < -0.5) pac.px = COLS - 0.5
      if (pac.px > COLS - 0.5) pac.px = -0.5

      // eat
      const tx = Math.round(pac.px)
      const ty = Math.round(pac.py)
      if (nearCenter(pac.px) && nearCenter(pac.py) && tx >= 0 && tx < COLS) {
        const c = grid[ty][tx]
        if (c === '.') {
          grid[ty][tx] = ' '
          score += 10
          pellets--
          dotFlash = 0.06
          if (score > best) saveBest()
        } else if (c === 'o') {
          grid[ty][tx] = ' '
          score += 50
          pellets--
          triggerFright()
          if (score > best) saveBest()
        }
      }
      if (pellets <= 0) winLevel()
    }

    function moveGhost(g, dt) {
      let speed = g.speed
      if (g.frightened) speed *= 0.6
      if (g.eaten) speed *= 2.4
      const step = speed * dt

      if (nearCenter(g.px) && nearCenter(g.py)) {
        g.px = Math.round(g.px)
        g.py = Math.round(g.py)
        // arrived at pen while eaten -> revive
        if (g.eaten && Math.round(g.px) === PEN.x && Math.round(g.py) === PEN.y) {
          g.eaten = false
          g.frightened = false
          g.dir = { x: 0, y: -1 }
        }
        // door allowed when leaving/entering pen
        const allowDoor =
          g.eaten ||
          (Math.round(g.py) >= 7 && Math.round(g.py) <= 9 && Math.round(g.px) >= 8 && Math.round(g.px) <= 10)
        g.dir = chooseGhostDir(g, allowDoor)
      }

      g.px += g.dir.x * step
      g.py += g.dir.y * step
      if (g.px < -0.5) g.px = COLS - 0.5
      if (g.px > COLS - 0.5) g.px = -0.5
    }

    function triggerFright() {
      frightTimer = Math.max(2.5, 7 - (level - 1) * 0.6)
      ghosts.forEach((g) => {
        if (!g.eaten) {
          g.frightened = true
          // reverse on fright
          g.dir = { x: -g.dir.x, y: -g.dir.y }
        }
      })
    }

    function saveBest() {
      best = score
      localStorage.setItem(HS_KEY, String(best))
    }

    let frightCombo = 0
    function checkCollisions() {
      for (const g of ghosts) {
        const dx = g.px - pac.px
        const dy = g.py - pac.py
        if (dx * dx + dy * dy < 0.36) {
          if (g.eaten) continue
          if (g.frightened) {
            g.eaten = true
            g.frightened = false
            frightCombo++
            score += 200 * frightCombo
            if (score > best) saveBest()
          } else {
            loseLife()
            return
          }
        }
      }
    }

    function loseLife() {
      lives--
      if (lives <= 0) {
        state = 'over'
        if (auto) finishSession(false)
      } else {
        placeActors()
        state = 'ready'
      }
    }

    function winLevel() {
      // Autoplay: clearing a level (or reaching the score threshold) is a session win.
      if (auto) finishSession(true)
      level++
      pac.speed += 0.4
      grid = MAZE.map((r) =>
        r.split('').map((c) => (c === 'P' ? '.' : c === 'T' ? ' ' : c)),
      )
      buildPellets()
      placeActors()
      state = 'ready'
    }

    // ---------- input ----------
    function setNext(x, y) {
      pac.next = { x, y }
    }
    function onKey(e) {
      const k = e.code
      if (state === 'over') {
        if (['Space', 'Enter', 'KeyR'].includes(k)) {
          e.preventDefault()
          reset(true)
        }
        return
      }
      if (k === 'KeyP' && state !== 'ready') {
        if (!e.repeat) state = state === 'paused' ? 'playing' : 'paused'
        return
      }
      let moved = true
      if (k === 'ArrowUp' || k === 'KeyW') setNext(0, -1)
      else if (k === 'ArrowDown' || k === 'KeyS') setNext(0, 1)
      else if (k === 'ArrowLeft' || k === 'KeyA') setNext(-1, 0)
      else if (k === 'ArrowRight' || k === 'KeyD') setNext(1, 0)
      else if (k === 'Space') {
        if (state === 'ready') startPlay()
        moved = false
      } else moved = false
      if (moved) {
        e.preventDefault()
        if (state === 'ready') startPlay()
      }
    }
    function startPlay() {
      state = 'playing'
      last = performance.now()
    }
    function onPointer() {
      if (state === 'over') reset(true)
      else if (state === 'ready') startPlay()
    }
    window.addEventListener('keydown', onKey)
    canvas.addEventListener('pointerdown', onPointer)

    // ---------- drawing ----------
    function px(tx) {
      return GRID_X + (tx + 0.5) * TILE
    }
    function py(ty) {
      return GRID_Y + (ty + 0.5) * TILE
    }

    function sparkle(x, y, s) {
      ctx.strokeStyle = PINK
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(x - s, y)
      ctx.lineTo(x + s, y)
      ctx.moveTo(x, y - s)
      ctx.lineTo(x, y + s)
      ctx.stroke()
    }

    function drawWalls() {
      ctx.lineWidth = 3
      ctx.lineCap = 'round'
      const inset = 4
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          const c = grid[y][x]
          if (c === '-') {
            // pen door
            ctx.strokeStyle = PINK
            ctx.shadowColor = PINK
            ctx.shadowBlur = 8
            ctx.beginPath()
            ctx.moveTo(GRID_X + x * TILE + 3, py(y))
            ctx.lineTo(GRID_X + (x + 1) * TILE - 3, py(y))
            ctx.stroke()
            ctx.shadowBlur = 0
            continue
          }
          if (c !== '#') continue
          const gx = GRID_X + x * TILE
          const gy = GRID_Y + y * TILE
          // alternate glow color for depth
          const col = (x + y) % 2 === 0 ? WALL : '#3b6cff'
          ctx.strokeStyle = col
          ctx.shadowColor = col
          ctx.shadowBlur = 8
          // draw edges that border non-wall tiles (gives maze outline look)
          const top = tileChar(x, y - 1) !== '#'
          const bot = tileChar(x, y + 1) !== '#'
          const lft = tileChar(x - 1, y) !== '#'
          const rgt = tileChar(x + 1, y) !== '#'
          ctx.beginPath()
          if (top) {
            ctx.moveTo(gx, gy + inset)
            ctx.lineTo(gx + TILE, gy + inset)
          }
          if (bot) {
            ctx.moveTo(gx, gy + TILE - inset)
            ctx.lineTo(gx + TILE, gy + TILE - inset)
          }
          if (lft) {
            ctx.moveTo(gx + inset, gy)
            ctx.lineTo(gx + inset, gy + TILE)
          }
          if (rgt) {
            ctx.moveTo(gx + TILE - inset, gy)
            ctx.lineTo(gx + TILE - inset, gy + TILE)
          }
          // if it's an interior solid block (no open neighbors), fill faint
          if (!top && !bot && !lft && !rgt) {
            ctx.rect(gx + inset, gy + inset, TILE - inset * 2, TILE - inset * 2)
          }
          ctx.stroke()
        }
      }
      ctx.shadowBlur = 0
    }

    function drawPellets(t) {
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          const c = grid[y][x]
          if (c === '.') {
            ctx.fillStyle = '#fff'
            ctx.beginPath()
            ctx.arc(px(x), py(y), 2.4, 0, Math.PI * 2)
            ctx.fill()
          } else if (c === 'o') {
            const pulse = 4 + Math.sin(t * 6) * 1.8
            ctx.fillStyle = PINK
            ctx.shadowColor = PINK
            ctx.shadowBlur = 12
            ctx.beginPath()
            ctx.arc(px(x), py(y), pulse, 0, Math.PI * 2)
            ctx.fill()
            ctx.shadowBlur = 0
          }
        }
      }
    }

    function drawPac() {
      const cx = px(pac.px)
      const cy = py(pac.py)
      const r = TILE * 0.46
      // mouth angle animation
      const open = (Math.sin(mouth * 12) * 0.5 + 0.5) * 0.32 + 0.04
      let a = 0
      if (pac.dir.x === 1) a = 0
      else if (pac.dir.x === -1) a = Math.PI
      else if (pac.dir.y === 1) a = Math.PI / 2
      else if (pac.dir.y === -1) a = -Math.PI / 2
      ctx.fillStyle = YELLOW
      ctx.shadowColor = YELLOW
      ctx.shadowBlur = 16
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.arc(cx, cy, r, a + open * Math.PI, a - open * Math.PI + Math.PI * 2)
      ctx.closePath()
      ctx.fill()
      ctx.shadowBlur = 0
    }

    function drawGhost(g, t) {
      const cx = px(g.px)
      const cy = py(g.py)
      const r = TILE * 0.44
      let col = g.color
      if (g.eaten) col = 'rgba(160,180,255,0.35)'
      else if (g.frightened) {
        const flash = frightTimer < 2 && Math.floor(t * 8) % 2 === 0
        col = flash ? '#fff' : FRIGHT
      }
      if (!g.eaten) {
        ctx.fillStyle = col
        ctx.shadowColor = col
        ctx.shadowBlur = 12
        ctx.beginPath()
        ctx.arc(cx, cy - 1, r, Math.PI, 0)
        // skirt
        const base = cy + r - 2
        ctx.lineTo(cx + r, base)
        const feet = 3
        for (let i = 0; i < feet; i++) {
          const fx = cx + r - ((i + 0.5) * (2 * r)) / feet
          ctx.lineTo(fx, base - 4)
          ctx.lineTo(cx + r - ((i + 1) * (2 * r)) / feet, base)
        }
        ctx.lineTo(cx - r, cy - 1)
        ctx.closePath()
        ctx.fill()
        ctx.shadowBlur = 0
      }
      // eyes (always)
      const look = g.frightened && !g.eaten ? { x: 0, y: 0 } : g.dir
      const ex = look.x * 2
      const ey = look.y * 2
      ctx.fillStyle = '#fff'
      ctx.beginPath()
      ctx.arc(cx - 4, cy - 2, 3, 0, Math.PI * 2)
      ctx.arc(cx + 4, cy - 2, 3, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = g.frightened && !g.eaten ? FRIGHT : '#0a0a0a'
      ctx.beginPath()
      ctx.arc(cx - 4 + ex, cy - 2 + ey, 1.5, 0, Math.PI * 2)
      ctx.arc(cx + 4 + ex, cy - 2 + ey, 1.5, 0, Math.PI * 2)
      ctx.fill()
    }

    function drawHeader() {
      ctx.textAlign = 'left'
      ctx.fillStyle = PINK
      ctx.font = '700 12px system-ui, sans-serif'
      ctx.fillText('SCORE', PAD, PAD + 12)
      ctx.fillRect(PAD, PAD + 17, 22, 3)
      ctx.fillStyle = '#fff'
      ctx.font = '800 22px system-ui, sans-serif'
      ctx.fillText(String(score), PAD + 56, PAD + 18)

      // LIVES (center-ish)
      ctx.fillStyle = PINK
      ctx.font = '700 12px system-ui, sans-serif'
      ctx.fillText('LIVES', PAD + 150, PAD + 12)
      ctx.fillRect(PAD + 150, PAD + 17, 22, 3)
      for (let i = 0; i < lives; i++) {
        const lx = PAD + 152 + i * 18
        ctx.fillStyle = YELLOW
        ctx.beginPath()
        ctx.arc(lx + 6, PAD + 32, 6, 0.25 * Math.PI, 1.75 * Math.PI)
        ctx.lineTo(lx + 6, PAD + 32)
        ctx.closePath()
        ctx.fill()
      }

      ctx.textAlign = 'right'
      ctx.fillStyle = '#8a93ad'
      ctx.font = '600 12px system-ui, sans-serif'
      ctx.fillText('BEST  ' + best, W - PAD, PAD + 12)
      ctx.fillStyle = '#8a93ad'
      ctx.fillText('LEVEL  ' + level, W - PAD, PAD + 30)
    }

    function overlay(title, sub) {
      ctx.fillStyle = 'rgba(10,10,10,0.78)'
      ctx.fillRect(GRID_X, GRID_Y, COLS * TILE, ROWS * TILE)
      const mx = GRID_X + (COLS * TILE) / 2
      const my = GRID_Y + (ROWS * TILE) / 2
      ctx.textAlign = 'center'
      ctx.fillStyle = PINK
      ctx.font = '800 34px system-ui, sans-serif'
      ctx.fillText(title, mx, my - 6)
      ctx.fillStyle = PINK
      ctx.fillRect(mx - 60, my + 6, 120, 4)
      ctx.fillStyle = '#fff'
      ctx.font = '600 14px system-ui, sans-serif'
      ctx.fillText(sub, mx, my + 36)
    }

    function draw(t) {
      ctx.fillStyle = '#0a0a0a'
      ctx.fillRect(0, 0, W, H)
      sparkle(W - 26, 22, 5)
      sparkle(26, H - 26, 4)

      drawHeader()

      // playfield bg
      ctx.fillStyle = '#0c0c14'
      ctx.fillRect(GRID_X, GRID_Y, COLS * TILE, ROWS * TILE)

      drawWalls()
      drawPellets(t)
      ghosts.forEach((g) => drawGhost(g, t))
      drawPac()

      // frame
      ctx.strokeStyle = PINK
      ctx.lineWidth = 2
      ctx.shadowColor = PINK
      ctx.shadowBlur = 6
      ctx.strokeRect(GRID_X - 1, GRID_Y - 1, COLS * TILE + 2, ROWS * TILE + 2)
      ctx.shadowBlur = 0

      if (state === 'ready') overlay('PAC-MAN', 'arrows / WASD — space to start')
      else if (state === 'paused') overlay('PAUSED', 'press P to resume')
      else if (state === 'over') overlay('GAME OVER', 'tap / space to play again')
    }

    function update(dt) {
      mouth += dt
      if (dotFlash > 0) dotFlash -= dt

      // global scatter/chase cycle
      if (frightTimer <= 0) {
        phaseTimer += dt
        if (mode === 'scatter' && phaseTimer > 7) {
          mode = 'chase'
          phaseTimer = 0
        } else if (mode === 'chase' && phaseTimer > 20) {
          mode = 'scatter'
          phaseTimer = 0
        }
      }

      if (frightTimer > 0) {
        frightTimer -= dt
        if (frightTimer <= 0) {
          ghosts.forEach((g) => (g.frightened = false))
          frightCombo = 0
        }
      }

      movePac(dt)
      ghosts.forEach((g) => moveGhost(g, dt))
      checkCollisions()
    }

    // ---------- AUTOPLAY bot ----------
    // Drives pac.next (the game's own queued-direction logic) at intersections.
    // Win session = cleared a level (ate all pellets) OR score >= WIN_SCORE, before
    // losing all lives. shouldAutoWin('pac-man') self-corrects the rate to ~95%.
    //   wantWin true  => greedy toward nearest pellet, strongly avoid live ghosts,
    //                    chase frightened ghosts after a power pellet, survive + clear.
    //   wantWin false => ignore ghosts (walk into them) so it loses all lives fast.
    const WIN_SCORE = 2000
    let wantWin = shouldAutoWin('pac-man')
    let sessionDone = false // ensures exactly one recordAutoplayResult per session
    let overAt = 0

    function finishSession(cleared) {
      if (sessionDone) return
      sessionDone = true
      const clearedLevel = cleared === true || score >= WIN_SCORE
      recordAutoplayResult('pac-man', clearedLevel)
    }

    // BFS from Pac's tile; returns the first step toward the nearest pellet AND the
    // distance, while routing AROUND tiles adjacent to live (dangerous) ghosts.
    function nearestPelletStep(avoid) {
      const sx = Math.round(pac.px)
      const sy = Math.round(pac.py)
      const seen = new Set()
      const q = [{ x: sx, y: sy, first: null, dist: 0 }]
      seen.add(sx + ',' + sy)
      let head = 0
      while (head < q.length) {
        const cur = q[head++]
        const c = tileChar(cur.x, cur.y)
        if ((c === '.' || c === 'o') && cur.first) return { dir: cur.first, dist: cur.dist }
        for (const d of DIRS) {
          const nx = wrapX(cur.x + d.x)
          const ny = cur.y + d.y
          if (ny < 0 || ny >= ROWS) continue
          if (isWall(nx, ny, false)) continue
          const key = nx + ',' + ny
          if (seen.has(key)) continue
          seen.add(key)
          // never route the search through a tile a live ghost can hit next
          if (avoid && cur.first === null && avoid(nx, ny)) continue
          q.push({ x: nx, y: ny, first: cur.first || d, dist: cur.dist + 1 })
        }
      }
      return null
    }

    // Direction toward the nearest frightened ghost worth chasing (or null).
    function frightenedStep() {
      if (frightTimer <= 1) return null
      const sx = Math.round(pac.px)
      const sy = Math.round(pac.py)
      const seen = new Set()
      const q = [{ x: sx, y: sy, first: null, dist: 0 }]
      seen.add(sx + ',' + sy)
      let head = 0
      while (head < q.length) {
        const cur = q[head++]
        if (cur.dist > 8) break
        for (const g of ghosts) {
          if (g.frightened && !g.eaten && Math.round(g.px) === cur.x && Math.round(g.py) === cur.y && cur.first) {
            return cur.first
          }
        }
        for (const d of DIRS) {
          const nx = wrapX(cur.x + d.x)
          const ny = cur.y + d.y
          if (ny < 0 || ny >= ROWS) continue
          if (isWall(nx, ny, false)) continue
          const key = nx + ',' + ny
          if (seen.has(key)) continue
          seen.add(key)
          q.push({ x: nx, y: ny, first: cur.first || d, dist: cur.dist + 1 })
        }
      }
      return null
    }

    // Manhattan-ish grid distance penalty for a tile relative to live ghosts.
    function ghostDangerAt(tx, ty) {
      let pen = 0
      for (const g of ghosts) {
        if (g.eaten) continue
        if (g.frightened && frightTimer > 1) continue // safe to be near these
        const dx = wrapX(tx) - Math.round(g.px)
        const dy = ty - Math.round(g.py)
        const d2 = dx * dx + dy * dy
        if (d2 <= 1) pen += 1000000 // same / adjacent tile = death
        else if (d2 <= 4) pen += 60000
        else if (d2 <= 9) pen += 12000
        else if (d2 <= 25) pen += (25 - d2) * 300
      }
      return pen
    }

    // Is tile (tx,ty) one a live ghost occupies or could step onto next? Used to
    // forbid pellet routing through near-certain death.
    function lethalNext(tx, ty) {
      for (const g of ghosts) {
        if (g.eaten) continue
        if (g.frightened && frightTimer > 1) continue
        const dx = wrapX(tx) - Math.round(g.px)
        const dy = ty - Math.round(g.py)
        if (dx * dx + dy * dy <= 1) return true
      }
      return false
    }

    function botDecide() {
      const cx = Math.round(pac.px)
      const cy = Math.round(pac.py)
      // only decide when centered on a tile (smooth: one decision per tile center)
      if (!nearCenter(pac.px) || !nearCenter(pac.py)) return

      if (!wantWin) {
        // LOSE: head straight for the nearest live ghost.
        let target = null
        let bd = Infinity
        for (const g of ghosts) {
          if (g.eaten || g.frightened) continue
          const d = Math.abs(cx - Math.round(g.px)) + Math.abs(cy - Math.round(g.py))
          if (d < bd) { bd = d; target = g }
        }
        let bestDir = null
        let bestScore = Infinity
        for (const d of DIRS) {
          const nx = wrapX(cx + d.x)
          const ny = cy + d.y
          if (ny < 0 || ny >= ROWS) continue
          if (isWall(nx, ny, false)) continue
          const ddx = nx - (target ? Math.round(target.px) : nx)
          const ddy = ny - (target ? Math.round(target.py) : ny)
          const s = ddx * ddx + ddy * ddy
          if (s < bestScore) { bestScore = s; bestDir = d }
        }
        if (bestDir) setNext(bestDir.x, bestDir.y)
        return
      }

      // WIN: prefer hunting a frightened ghost (free points + clears threat),
      // otherwise greedy toward nearest pellet while avoiding live ghosts.
      const chase = frightenedStep()
      const pellet = nearestPelletStep(lethalNext) || nearestPelletStep(null)
      const pelletDir = chase || (pellet && pellet.dir)

      let bestDir = null
      let bestScore = -Infinity
      for (const d of DIRS) {
        const nx = wrapX(cx + d.x)
        const ny = cy + d.y
        if (ny < 0 || ny >= ROWS) continue
        if (isWall(nx, ny, false)) continue
        let s = 0
        if (d.x === -pac.dir.x && d.y === -pac.dir.y) s -= 40 // avoid jitter/reversing
        if (pelletDir && d.x === pelletDir.x && d.y === pelletDir.y) s += 500
        s -= ghostDangerAt(nx, ny)
        if (s > bestScore) {
          bestScore = s
          bestDir = d
        }
      }
      if (bestDir) setNext(bestDir.x, bestDir.y)
    }

    function autoTick(now) {
      if (state === 'ready') {
        // New round about to start: decide intent and arm a fresh session.
        wantWin = shouldAutoWin('pac-man')
        sessionDone = false
        startPlay()
      } else if (state === 'playing') {
        botDecide()
      } else if (state === 'over') {
        finishSession(false) // safety: record once if not already
        if (!overAt) overAt = now
        else if (now - overAt > 1300) {
          overAt = 0
          reset(true)
        }
      }
    }

    function loop(now) {
      let dt = (now - last) / 1000
      last = now
      if (dt > 0.05) dt = 0.05 // clamp
      if (auto) autoTick(now)
      if (state === 'playing') update(dt)
      draw(now / 1000)
      raf = requestAnimationFrame(loop)
    }

    reset(true)
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKey)
      canvas.removeEventListener('pointerdown', onPointer)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      className="pacman-canvas"
      aria-label="Pac-Man game"
    />
  )
}
