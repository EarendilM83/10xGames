import { useEffect, useRef } from 'react'
import { isAutoplay, shouldAutoWin, recordAutoplayResult } from '../autoplay.js'

// Battle-City-style tank defense on canvas, 10x neon-on-black style.
// 13x13 tile battlefield of 40px = 520, plus a 60px HUD strip on top.
// Original geometric/neon art only — no copyrighted sprites or names.
const COLS = 13
const ROWS = 13
const TILE = 40
const HUD = 60
const W = COLS * TILE          // 520
const H = ROWS * TILE + HUD    // 580

const PINK = '#ff2d6f'
const HS_KEY = '10xgames.tanks.best'

// Terrain codes used by the level char grids:
//  '.' empty   'B' brick   'S' steel   'W' water   'F' forest
// Tiles are stored per-cell; brick is destructible in 4 quadrant sub-cells.
const EMPTY = 0, BRICK = 1, STEEL = 2, WATER = 3, FOREST = 4

const DIRS = [
  { dx: 0, dy: -1 }, // 0 up
  { dx: 1, dy: 0 },  // 1 right
  { dx: 0, dy: 1 },  // 2 down
  { dx: -1, dy: 0 }, // 3 left
]

// Hand-made level layouts (13 wide x 13 tall). Base eagle sits at col 6, row 12.
// The 3 tiles around the base (row 11-12, cols 5-7) are walled with brick.
const LEVELS = [
  [
    '.............',
    '.BB.BB.BB.BB.',
    '.BB.BB.BB.BB.',
    '.............',
    '..S.......S..',
    '.BB.WW.WW.BB.',
    '.BB.WW.WW.BB.',
    '..S.......S..',
    '.............',
    '.BB.BB.BB.BB.',
    '.....BBB.....',
    '.....B.B.....',
    '.....B.B.....',
  ],
  [
    '...F.....F...',
    '.S.F.BBB.F.S.',
    '...F.B.B.F...',
    '.BBB.....BBB.',
    '.B.........B.',
    '...WWW.WWW...',
    '..S.......S..',
    '...WWW.WWW...',
    '.B.........B.',
    '.BBB.BBB.BBB.',
    '.....BBB.....',
    '.....B.B.....',
    '.....B.B.....',
  ],
  [
    '.S.........S.',
    '.S.BB.BB.BB.S',
    '...BB.BB.BB..',
    'FF.........FF',
    'FF.SS.SS.SS.F',
    '...........  ',
    '.WW.WW.WW.WW.',
    '.............',
    '.BB.FF.FF.BB.',
    '.BB.BBB.B.BB.',
    '.....BBB.....',
    '.....B.B.....',
    '.....B.B.....',
  ],
  [
    'S...S...S...S',
    '.BBB.BBB.BBB.',
    '.B.B.B.B.B.B.',
    '.............',
    '.WW.SS.SS.WW.',
    '.WW.......WW.',
    '..F.FFF.F.F..',
    '.WW.......WW.',
    '.WW.SS.SS.WW.',
    '.BBB.....BBB.',
    '.....BBB.....',
    '.....B.B.....',
    '.....B.B.....',
  ],
  [
    '.BB.SS.SS.BB.',
    '.BB.S...S.BB.',
    '....S.F.S....',
    'WW.....F...WW',
    'WW.BBB.BBB.WW',
    '...B.....B...',
    '.F.........F.',
    '...B.....B...',
    'WW.BBB.BBB.WW',
    '.BB.....BB...',
    '.....BBB.....',
    '.....B.B.....',
    '.....B.B.....',
  ],
]

const BASE_COL = 6
const BASE_ROW = 12

export default function Tanks() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')

    const auto = isAutoplay('tanks')
    let wantWin = true, restartAt = 0, recorded = false
    // win session = cleared at least one level (reached level >= 2) with base + lives intact
    let clearedSession = false

    // ---- world state ----
    // tiles[r][c] = terrain code. brick[r][c] = 4-bit mask of intact quadrants (TL,TR,BL,BR).
    let tiles, brick
    let player, enemies, bullets, powerups, effects
    let base                // { alive }
    let level, lives, score, best
    let enemiesLeft         // enemies still to spawn this level
    let enemiesAlive        // live enemy count on screen
    let spawnTimer
    let state               // 'ready' | 'playing' | 'over' | 'levelclear'
    let shieldTimer         // player invuln seconds
    let fireLevel           // 0..2 (star upgrades): speed/power
    let baseFortify         // seconds the base walls are steel
    let levelClearTimer

    const MAX_ON_SCREEN = 4
    const PER_LEVEL = 20

    best = Number(localStorage.getItem(HS_KEY)) || 0
    let last = performance.now(), raf = 0
    let restartTO = 0

    // pixel helpers
    const px = (c) => c * TILE
    const py = (r) => HUD + r * TILE

    // ---------- level build ----------
    function buildLevel() {
      const grid = LEVELS[(level - 1) % LEVELS.length]
      tiles = []
      brick = []
      for (let r = 0; r < ROWS; r++) {
        tiles.push(new Array(COLS).fill(EMPTY))
        brick.push(new Array(COLS).fill(0))
        const row = grid[r] || ''
        for (let c = 0; c < COLS; c++) {
          const ch = row[c] || '.'
          if (ch === 'B') { tiles[r][c] = BRICK; brick[r][c] = 0b1111 }
          else if (ch === 'S') tiles[r][c] = STEEL
          else if (ch === 'W') tiles[r][c] = WATER
          else if (ch === 'F') tiles[r][c] = FOREST
        }
      }
      // ensure base cell is empty
      tiles[BASE_ROW][BASE_COL] = EMPTY
      brick[BASE_ROW][BASE_COL] = 0
    }

    function resetPlayer() {
      player = {
        x: px(4) + 2, y: py(ROWS - 1) + 2, w: TILE - 4, h: TILE - 4,
        dir: 0, speed: 110, moving: false,
      }
      shieldTimer = 2.0 // brief spawn shield
    }

    function newLevel() {
      buildLevel()
      base = { alive: true }
      enemies = []
      bullets = []
      powerups = []
      effects = []
      enemiesLeft = PER_LEVEL
      enemiesAlive = 0
      spawnTimer = 0.4
      baseFortify = 0
      resetPlayer()
    }

    function reset() {
      level = 1
      lives = 3
      score = 0
      fireLevel = 0
      state = 'ready'
      newLevel()
    }

    // enemy strength scaling — weaker/slower in winning autoplay rounds
    function enemySpeedBase() {
      let s = 56 + (level - 1) * 6
      if (auto) s = wantWin ? 40 + (level - 1) * 3 : 78 + (level - 1) * 8
      return s
    }
    function enemyFireRate() {
      // mean seconds between shots
      if (auto) return wantWin ? 2.6 : 1.0
      return 1.6
    }

    function spawnEnemy() {
      const cols = [0, 6, 12]
      // pick a spawn column whose top cell is roughly clear
      let col = cols[Math.floor(Math.random() * cols.length)]
      const kinds = ['cyan', 'purple', 'orange']
      const kind = kinds[Math.floor(Math.random() * kinds.length)]
      const speed = enemySpeedBase() * (kind === 'orange' ? 1.25 : kind === 'purple' ? 1.0 : 0.85)
      // ~1 in 5 enemies carries a powerup (flashing)
      const carrier = Math.random() < 0.22
      enemies.push({
        x: px(col) + 2, y: py(0) + 2, w: TILE - 4, h: TILE - 4,
        dir: 2, speed, kind, fireTimer: 0.6 + Math.random() * enemyFireRate(),
        turnTimer: 0.3 + Math.random() * 0.6, carrier, hp: kind === 'purple' ? 2 : 1,
      })
      enemiesAlive++
      enemiesLeft--
    }

    // ---------- collision helpers ----------
    // axis-aligned rect overlap
    function overlap(a, b) {
      return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
    }

    // can a tank-sized box occupy (nx,ny)? checks terrain (brick/steel/water block).
    function tankBlocked(nx, ny, w, h, self) {
      if (nx < 0 || ny < HUD || nx + w > W || ny + h > H) return true
      const c0 = Math.floor((nx) / TILE)
      const c1 = Math.floor((nx + w - 1) / TILE)
      const r0 = Math.floor((ny - HUD) / TILE)
      const r1 = Math.floor((ny + h - 1 - HUD) / TILE)
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return true
          const t = tiles[r][c]
          if (t === BRICK && brick[r][c]) return true
          if (t === STEEL) return true
          if (t === WATER) return true
        }
      }
      // base blocks tanks
      if (base.alive) {
        const bx = px(BASE_COL), by = py(BASE_ROW)
        if (nx < bx + TILE && nx + w > bx && ny < by + TILE && ny + h > by) return true
      }
      // other tanks block
      const all = [player, ...enemies]
      for (const o of all) {
        if (o === self || !o) continue
        if (nx < o.x + o.w && nx + w > o.x && ny < o.y + o.h && ny + h > o.y) return true
      }
      return false
    }

    function moveTank(t, dt) {
      const d = DIRS[t.dir]
      const dist = t.speed * dt
      const nx = t.x + d.dx * dist
      const ny = t.y + d.dy * dist
      if (!tankBlocked(nx, ny, t.w, t.h, t)) { t.x = nx; t.y = ny; return true }
      return false
    }

    function fire(t, owner) {
      const d = DIRS[t.dir]
      const cx = t.x + t.w / 2
      const cy = t.y + t.h / 2
      const bw = 6, bh = 6
      const power = owner === 'player' && fireLevel >= 2 ? 2 : 1
      const speed = owner === 'player' ? 300 + fireLevel * 40 : 220
      bullets.push({
        x: cx - bw / 2 + d.dx * t.w / 2, y: cy - bh / 2 + d.dy * t.h / 2,
        w: bw, h: bh, dir: t.dir, speed, owner, power,
      })
    }

    // damage a brick cell's quadrants hit by a bullet coming from `dir`.
    function hitBrick(r, c, dir, power) {
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return
      if (tiles[r][c] !== BRICK || !brick[r][c]) return
      // quadrant bits: TL=1, TR=2, BL=4, BR=8
      let mask
      if (power >= 2) mask = 0b1111
      else if (dir === 0) mask = 0b0011 // moving up -> clear bottom row? clear nearest = bottom
      else if (dir === 2) mask = 0b1100
      else if (dir === 1) mask = 0b0101
      else mask = 0b1010
      // first hit clears the near side; if already cleared, clear the rest
      const cur = brick[r][c]
      if (cur & mask) brick[r][c] = cur & ~mask
      else brick[r][c] = 0
      if (brick[r][c] === 0) tiles[r][c] = EMPTY
      effects.push({ x: px(c) + TILE / 2, y: py(r) + TILE / 2, t: 0.18, col: '#ff8a1e' })
    }

    // bullet vs terrain: returns true if bullet should die
    function bulletTerrain(b) {
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2
      const c = Math.floor(cx / TILE)
      const r = Math.floor((cy - HUD) / TILE)
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return false
      const t = tiles[r][c]
      if (t === BRICK && brick[r][c]) { hitBrick(r, c, b.dir, b.power); return true }
      if (t === STEEL) {
        if (b.owner === 'player' && b.power >= 2) {
          tiles[r][c] = EMPTY
          effects.push({ x: px(c) + TILE / 2, y: py(r) + TILE / 2, t: 0.2, col: '#2de2e6' })
        }
        return true
      }
      // water/forest: bullets pass
      return false
    }

    function killEnemy(e, idx) {
      enemies.splice(idx, 1)
      enemiesAlive--
      score += 100
      effects.push({ x: e.x + e.w / 2, y: e.y + e.h / 2, t: 0.3, col: e.kind === 'cyan' ? '#2de2e6' : e.kind === 'purple' ? '#b14aed' : '#ff8a1e' })
      if (e.carrier) dropPowerup(e.x + e.w / 2, e.y + e.h / 2)
      if (score > best) { best = score; localStorage.setItem(HS_KEY, String(best)) }
    }

    function dropPowerup(x, y) {
      const kinds = ['star', 'helmet', 'grenade', 'shovel']
      const kind = kinds[Math.floor(Math.random() * kinds.length)]
      powerups.push({ x: x - 14, y: y - 14, w: 28, h: 28, kind, t: 12 })
    }

    function applyPowerup(p) {
      if (p.kind === 'star') fireLevel = Math.min(2, fireLevel + 1)
      else if (p.kind === 'helmet') shieldTimer = 8
      else if (p.kind === 'grenade') {
        for (let i = enemies.length - 1; i >= 0; i--) killEnemy(enemies[i], i)
      } else if (p.kind === 'shovel') baseFortify = 14
      effects.push({ x: p.x + p.w / 2, y: p.y + p.h / 2, t: 0.3, col: '#ffd60a' })
      score += 50
    }

    function loseLife() {
      lives--
      if (lives <= 0) endSession(false)
      else { resetPlayer() }
    }

    function destroyBase() {
      base.alive = false
      effects.push({ x: px(BASE_COL) + TILE / 2, y: py(BASE_ROW) + TILE / 2, t: 0.6, col: PINK })
      endSession(false)
    }

    function endSession(won) {
      state = 'over'
      if (score > best) { best = score; localStorage.setItem(HS_KEY, String(best)) }
      if (auto && !recorded) {
        recorded = true
        recordAutoplayResult('tanks', won || clearedSession)
      }
    }

    function clearLevelNow() {
      score += 500
      clearedSession = true
      if (score > best) { best = score; localStorage.setItem(HS_KEY, String(best)) }
      state = 'levelclear'
      levelClearTimer = 1.6
    }

    // ---------- update ----------
    function update(dt) {
      // tick effects always
      for (let i = effects.length - 1; i >= 0; i--) {
        effects[i].t -= dt
        if (effects[i].t <= 0) effects.splice(i, 1)
      }

      if (state === 'levelclear') {
        levelClearTimer -= dt
        if (levelClearTimer <= 0) { level++; newLevel(); state = 'playing' }
        return
      }
      if (state !== 'playing') return

      if (shieldTimer > 0) shieldTimer -= dt
      if (baseFortify > 0) baseFortify -= dt

      // player movement
      if (player.moving) moveTank(player, dt)

      // spawning
      if (enemiesLeft > 0 && enemiesAlive < MAX_ON_SCREEN) {
        spawnTimer -= dt
        if (spawnTimer <= 0) { spawnEnemy(); spawnTimer = 1.2 + Math.random() * 1.0 }
      }

      // enemy AI
      for (const e of enemies) {
        e.turnTimer -= dt
        e.fireTimer -= dt
        // try to move; if blocked or timer elapsed, pick a new direction
        const moved = moveTank(e, dt)
        if (!moved || e.turnTimer <= 0) {
          e.turnTimer = 0.4 + Math.random() * 1.0
          // bias toward the base / player
          const targetX = base.alive ? px(BASE_COL) : player.x
          const targetY = base.alive ? py(BASE_ROW) : player.y
          const dx = targetX - e.x, dy = targetY - e.y
          let pref
          if (Math.abs(dx) > Math.abs(dy)) pref = dx > 0 ? 1 : 3
          else pref = dy > 0 ? 2 : 0
          // 60% head toward target, else random
          e.dir = Math.random() < 0.6 ? pref : Math.floor(Math.random() * 4)
        }
        if (e.fireTimer <= 0) {
          e.fireTimer = 0.8 + Math.random() * enemyFireRate()
          fire(e, 'enemy')
        }
      }

      // bullets
      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i]
        const d = DIRS[b.dir]
        b.x += d.dx * b.speed * dt
        b.y += d.dy * b.speed * dt
        let dead = false
        if (b.x < 0 || b.x > W || b.y < HUD || b.y > H) dead = true
        if (!dead && bulletTerrain(b)) dead = true
        // hit base
        if (!dead && base.alive) {
          const bx = px(BASE_COL), by = py(BASE_ROW)
          if (b.x < bx + TILE && b.x + b.w > bx && b.y < by + TILE && b.y + b.h > by) {
            if (baseFortify > 0) { dead = true }
            else { destroyBase(); dead = true }
          }
        }
        if (!dead) {
          if (b.owner === 'player') {
            for (let j = enemies.length - 1; j >= 0; j--) {
              if (overlap(b, enemies[j])) {
                enemies[j].hp -= b.power
                if (enemies[j].hp <= 0) killEnemy(enemies[j], j)
                else effects.push({ x: b.x, y: b.y, t: 0.12, col: '#fff' })
                dead = true; break
              }
            }
          } else {
            if (shieldTimer <= 0 && overlap(b, player)) {
              dead = true
              effects.push({ x: player.x + player.w / 2, y: player.y + player.h / 2, t: 0.3, col: PINK })
              loseLife()
            }
          }
        }
        // bullet vs bullet
        if (!dead) {
          for (let k = bullets.length - 1; k >= 0; k--) {
            if (k === i) continue
            const o = bullets[k]
            if (o.owner !== b.owner && overlap(b, o)) {
              bullets.splice(k, 1); dead = true
              if (k < i) i--
              break
            }
          }
        }
        if (dead) bullets.splice(i, 1)
      }

      // powerups: pickup + expire
      for (let i = powerups.length - 1; i >= 0; i--) {
        const p = powerups[i]
        p.t -= dt
        if (p.t <= 0) { powerups.splice(i, 1); continue }
        if (overlap(p, player)) { applyPowerup(p); powerups.splice(i, 1) }
      }

      // level cleared?
      if (state === 'playing' && enemiesLeft <= 0 && enemiesAlive <= 0) clearLevelNow()
    }

    // ---------- player input ----------
    const keys = {}
    function updatePlayerDir() {
      if (state !== 'playing') return
      let dir = null
      if (keys.up) dir = 0
      else if (keys.right) dir = 1
      else if (keys.down) dir = 2
      else if (keys.left) dir = 3
      if (dir === null) { player.moving = false; return }
      player.dir = dir
      player.moving = true
    }

    let playerShotCool = 0
    function playerFire() {
      if (state !== 'playing' || playerShotCool > 0) return
      // limit concurrent player bullets
      const mine = bullets.filter((b) => b.owner === 'player').length
      const cap = fireLevel >= 1 ? 2 : 1
      if (mine >= cap) return
      fire(player, 'player')
      playerShotCool = 0.18
    }

    function onKey(e) {
      const k = e.code
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(k)) e.preventDefault()
      if (e.type === 'keyup') {
        if (k === 'ArrowUp' || k === 'KeyW') keys.up = false
        else if (k === 'ArrowDown' || k === 'KeyS') keys.down = false
        else if (k === 'ArrowLeft' || k === 'KeyA') keys.left = false
        else if (k === 'ArrowRight' || k === 'KeyD') keys.right = false
        updatePlayerDir()
        return
      }
      // keydown
      if (state !== 'playing') {
        if (['Space', 'Enter', 'KeyR'].includes(k)) {
          if (state === 'over') reset()
          state = 'playing'
        }
        return
      }
      if (k === 'ArrowUp' || k === 'KeyW') keys.up = true
      else if (k === 'ArrowDown' || k === 'KeyS') keys.down = true
      else if (k === 'ArrowLeft' || k === 'KeyA') keys.left = true
      else if (k === 'ArrowRight' || k === 'KeyD') keys.right = true
      else if (k === 'Space') playerFire()
      updatePlayerDir()
    }
    function onPointer() {
      if (state === 'over') { reset(); state = 'playing' }
      else if (state === 'ready') state = 'playing'
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    canvas.addEventListener('pointerdown', onPointer)

    // ---------- autoplay bot ----------
    // Is there a clear line of fire from the player to a target along an axis?
    // Used to decide when shooting hits something worthwhile (no steel/brick between).
    function clearShot(fromX, fromY, dir, targetX, targetY) {
      const d = DIRS[dir]
      // must be roughly aligned on the perpendicular axis
      if (dir === 0 || dir === 2) {
        if (Math.abs(fromX - targetX) > TILE * 0.6) return false
        if (dir === 0 && targetY > fromY) return false
        if (dir === 2 && targetY < fromY) return false
      } else {
        if (Math.abs(fromY - targetY) > TILE * 0.6) return false
        if (dir === 1 && targetX < fromX) return false
        if (dir === 3 && targetX > fromX) return false
      }
      // walk tiles from player toward target; stop if a blocking tile precedes the target
      let x = fromX, y = fromY
      const distTiles = Math.ceil((Math.abs(targetX - fromX) + Math.abs(targetY - fromY)) / TILE) + 1
      for (let i = 0; i < distTiles; i++) {
        x += d.dx * TILE; y += d.dy * TILE
        const c = Math.floor(x / TILE), r = Math.floor((y - HUD) / TILE)
        if (r < 0 || r >= ROWS || c < 0 || c >= COLS) break
        // reached target tile?
        if (Math.abs(x - targetX) < TILE && Math.abs(y - targetY) < TILE) return true
        const t = tiles[r][c]
        if (t === STEEL) return false
        if (t === BRICK && brick[r][c]) return fireLevel < 2 ? false : true
      }
      return true
    }

    // Is an enemy bullet about to hit the player? (used to dodge)
    function incomingBullet() {
      for (const b of bullets) {
        if (b.owner !== 'enemy') continue
        const d = DIRS[b.dir]
        // bullet heading roughly at the player on its axis
        if (d.dx !== 0) {
          if (Math.abs((b.y) - (player.y + player.h / 2)) > TILE * 0.7) continue
          const ahead = (player.x - b.x) * d.dx
          if (ahead > 0 && ahead < TILE * 4) return b
        } else {
          if (Math.abs((b.x) - (player.x + player.w / 2)) > TILE * 0.7) continue
          const ahead = (player.y - b.y) * d.dy
          if (ahead > 0 && ahead < TILE * 4) return b
        }
      }
      return null
    }

    let botFireCool = 0, botDir = 2
    function botStep(dt) {
      if (state !== 'playing') return
      botFireCool -= dt

      // LOSE rounds: sit passively near a corner and rarely shoot so the base falls.
      if (!wantWin) {
        keys.up = keys.down = keys.left = keys.right = false
        player.moving = false
        return
      }

      // --- dodge incoming fire by stepping perpendicular ---
      const inc = incomingBullet()
      if (inc && shieldTimer <= 0) {
        const horiz = DIRS[inc.dir].dx !== 0
        setBotDir(horiz ? (Math.random() < 0.5 ? 0 : 2) : (Math.random() < 0.5 ? 1 : 3))
        player.moving = true
        return
      }

      // --- pick the most threatening enemy (closest to base) as the target ---
      let target = null, bestScore = Infinity
      for (const e of enemies) {
        const db = Math.abs(e.x - px(BASE_COL)) + Math.abs(e.y - py(BASE_ROW))
        const dp = Math.abs(e.x - player.x) + Math.abs(e.y - player.y)
        const sc = db * 0.6 + dp * 0.4
        if (sc < bestScore) { bestScore = sc; target = e }
      }

      // grab a nearby powerup if convenient
      let goalX = player.x, goalY = player.y, aimDir = botDir
      if (powerups.length) {
        const p = powerups[0]
        goalX = p.x; goalY = p.y
      } else if (target) {
        const tcx = target.x + target.w / 2, tcy = target.y + target.h / 2
        const pcx = player.x + player.w / 2, pcy = player.y + player.h / 2
        // try to line up on an axis with the target
        if (Math.abs(pcx - tcx) <= Math.abs(pcy - tcy)) {
          aimDir = tcy < pcy ? 0 : 2
          goalX = tcx; goalY = player.y
        } else {
          aimDir = tcx < pcx ? 3 : 1
          goalY = tcy; goalX = player.x
        }
        // shoot if aligned with a clear shot
        const pd = aimDir
        if (clearShot(pcx, pcy, pd, tcx, tcy) && botFireCool <= 0) {
          setBotDir(pd)
          playerFire()
          botFireCool = 0.35
        }
      }

      // navigate toward goal: move on the axis with the larger gap first
      const gx = goalX - player.x, gy = goalY - player.y
      if (Math.abs(gx) < 4 && Math.abs(gy) < 4) {
        // arrived; face aim direction and occasionally shoot to break bricks toward base
        setBotDir(aimDir)
        if (botFireCool <= 0 && Math.random() < 0.5) { playerFire(); botFireCool = 0.4 }
        player.moving = false
        return
      }
      let wantDir
      if (Math.abs(gx) > Math.abs(gy)) wantDir = gx > 0 ? 1 : 3
      else wantDir = gy > 0 ? 2 : 0
      // if blocked along wantDir, try the other axis, then shoot bricks if stuck
      setBotDir(wantDir)
      player.moving = true
      const d = DIRS[wantDir]
      if (tankBlocked(player.x + d.dx * 3, player.y + d.dy * 3, player.w, player.h, player)) {
        // try perpendicular
        const alt = Math.abs(gx) > Math.abs(gy) ? (gy > 0 ? 2 : 0) : (gx > 0 ? 1 : 3)
        const ad = DIRS[alt]
        if (!tankBlocked(player.x + ad.dx * 3, player.y + ad.dy * 3, player.w, player.h, player)) {
          setBotDir(alt)
        } else if (botFireCool <= 0) {
          // blocked by brick — shoot through it
          playerFire(); botFireCool = 0.3
        }
      }
    }

    function setBotDir(dir) {
      keys.up = keys.down = keys.left = keys.right = false
      if (dir === 0) keys.up = true
      else if (dir === 1) keys.right = true
      else if (dir === 2) keys.down = true
      else keys.left = true
      botDir = dir
      updatePlayerDir()
    }

    // ---------- drawing ----------
    function roundRect(x, y, w, h, rr) {
      ctx.beginPath()
      ctx.moveTo(x + rr, y)
      ctx.arcTo(x + w, y, x + w, y + h, rr)
      ctx.arcTo(x + w, y + h, x, y + h, rr)
      ctx.arcTo(x, y + h, x, y, rr)
      ctx.arcTo(x, y, x + w, y, rr)
      ctx.closePath()
    }
    function sparkle(x, y, s) {
      ctx.strokeStyle = PINK; ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(x - s, y); ctx.lineTo(x + s, y)
      ctx.moveTo(x, y - s); ctx.lineTo(x, y + s)
      ctx.stroke()
    }

    function drawTank(t, body, glow) {
      const x = t.x, y = t.y, w = t.w, h = t.h
      ctx.save()
      ctx.shadowColor = glow; ctx.shadowBlur = 10
      ctx.fillStyle = body
      // treads
      roundRect(x, y, w, h, 5); ctx.fill()
      ctx.shadowBlur = 0
      // hull
      ctx.fillStyle = 'rgba(0,0,0,0.35)'
      roundRect(x + 5, y + 5, w - 10, h - 10, 4); ctx.fill()
      // turret + barrel
      ctx.fillStyle = body
      const cx = x + w / 2, cy = y + h / 2
      ctx.beginPath(); ctx.arc(cx, cy, w * 0.18, 0, Math.PI * 2); ctx.fill()
      const d = DIRS[t.dir]
      ctx.strokeStyle = body; ctx.lineWidth = 4
      ctx.beginPath(); ctx.moveTo(cx, cy)
      ctx.lineTo(cx + d.dx * (w / 2 + 4), cy + d.dy * (h / 2 + 4)); ctx.stroke()
      ctx.restore()
    }

    function draw() {
      ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, W, H)

      // ---- HUD ----
      ctx.textAlign = 'left'
      ctx.fillStyle = PINK; ctx.font = '700 11px system-ui, sans-serif'
      ctx.fillText('SCORE', 14, 18); ctx.fillRect(14, 23, 22, 3)
      ctx.fillStyle = '#fff'; ctx.font = '800 20px system-ui, sans-serif'
      ctx.fillText(String(score), 14, 46)

      ctx.textAlign = 'center'
      ctx.fillStyle = PINK; ctx.font = '700 11px system-ui, sans-serif'
      ctx.fillText('LIVES', W / 2 - 70, 18); ctx.fillRect(W / 2 - 81, 23, 22, 3)
      ctx.fillStyle = PINK; ctx.font = '800 18px system-ui, sans-serif'
      ctx.fillText('▮ '.repeat(Math.max(0, lives)).trim() || '—', W / 2 - 70, 45)

      ctx.fillStyle = PINK; ctx.font = '700 11px system-ui, sans-serif'
      ctx.fillText('ENEMIES', W / 2 + 30, 18); ctx.fillRect(W / 2 + 14, 23, 30, 3)
      ctx.fillStyle = '#2de2e6'; ctx.font = '800 18px system-ui, sans-serif'
      ctx.fillText(String(enemiesLeft + enemiesAlive), W / 2 + 30, 45)

      ctx.textAlign = 'right'
      ctx.fillStyle = PINK; ctx.font = '700 11px system-ui, sans-serif'
      ctx.fillText('LEVEL', W - 14, 18); ctx.fillRect(W - 36, 23, 22, 3)
      ctx.fillStyle = '#fff'; ctx.font = '800 20px system-ui, sans-serif'
      ctx.fillText(String(level), W - 14, 46)
      ctx.fillStyle = '#8a93ad'; ctx.font = '600 10px system-ui, sans-serif'
      ctx.textAlign = 'right'
      // best shown subtly at far right top
      ctx.fillText('BEST ' + best, W - 14, 56)

      // HUD divider
      ctx.strokeStyle = 'rgba(255,45,111,0.4)'; ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(0, HUD - 1); ctx.lineTo(W, HUD - 1); ctx.stroke()

      // ---- terrain ----
      // remember forest cells to draw on top of tanks
      const forestCells = []
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const x = px(c), y = py(r)
          const t = tiles[r][c]
          if (t === BRICK) {
            const m = brick[r][c]
            ctx.save()
            ctx.shadowColor = '#ff8a1e'; ctx.shadowBlur = 6
            // four quadrants
            const qs = [
              [m & 1, x, y], [m & 2, x + TILE / 2, y],
              [m & 4, x, y + TILE / 2], [m & 8, x + TILE / 2, y + TILE / 2],
            ]
            for (const [on, qx, qy] of qs) {
              if (!on) continue
              ctx.fillStyle = '#7a2e10'
              ctx.fillRect(qx + 1, qy + 1, TILE / 2 - 2, TILE / 2 - 2)
              ctx.fillStyle = '#ff6a1e'
              ctx.fillRect(qx + 2, qy + 2, TILE / 2 - 5, 4)
              ctx.fillRect(qx + 2, qy + TILE / 2 - 6, TILE / 2 - 5, 4)
            }
            ctx.restore()
          } else if (t === STEEL) {
            ctx.save()
            ctx.shadowColor = '#2de2e6'; ctx.shadowBlur = 8
            ctx.fillStyle = '#0e2b30'
            ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 4)
            ctx.strokeStyle = '#2de2e6'; ctx.lineWidth = 2
            ctx.strokeRect(x + 4, y + 4, TILE - 8, TILE - 8)
            ctx.beginPath(); ctx.moveTo(x + 4, y + 4); ctx.lineTo(x + TILE - 4, y + TILE - 4); ctx.stroke()
            ctx.restore()
          } else if (t === WATER) {
            const sh = Math.sin((performance.now() / 400) + (r + c)) * 0.5 + 0.5
            ctx.fillStyle = `rgba(40,90,200,${0.35 + sh * 0.25})`
            ctx.fillRect(x + 1, y + 1, TILE - 2, TILE - 2)
            ctx.strokeStyle = `rgba(120,180,255,${0.4 + sh * 0.4})`; ctx.lineWidth = 1.5
            ctx.beginPath()
            ctx.moveTo(x + 4, y + TILE / 2 + sh * 4)
            ctx.lineTo(x + TILE / 2, y + TILE / 2 - sh * 4)
            ctx.lineTo(x + TILE - 4, y + TILE / 2 + sh * 4)
            ctx.stroke()
          } else if (t === FOREST) {
            forestCells.push([x, y, r, c])
          }
        }
      }

      // ---- base (glowing pink emblem) ----
      if (base.alive) {
        const bx = px(BASE_COL), by = py(BASE_ROW)
        ctx.save()
        const fort = baseFortify > 0
        ctx.shadowColor = fort ? '#2de2e6' : PINK; ctx.shadowBlur = 16
        ctx.fillStyle = fort ? '#0e2b30' : '#2a0a18'
        roundRect(bx + 3, by + 3, TILE - 6, TILE - 6, 5); ctx.fill()
        // emblem: stylized eagle/star shape (original geometric)
        ctx.fillStyle = fort ? '#2de2e6' : PINK
        const cx = bx + TILE / 2, cy = by + TILE / 2
        ctx.beginPath()
        for (let i = 0; i < 5; i++) {
          const a = -Math.PI / 2 + i * (Math.PI * 2 / 5)
          const a2 = a + Math.PI / 5
          ctx.lineTo(cx + Math.cos(a) * 13, cy + Math.sin(a) * 13)
          ctx.lineTo(cx + Math.cos(a2) * 5, cy + Math.sin(a2) * 5)
        }
        ctx.closePath(); ctx.fill()
        ctx.restore()
      } else {
        const bx = px(BASE_COL), by = py(BASE_ROW)
        ctx.fillStyle = '#1a1a1a'; ctx.fillRect(bx + 4, by + 4, TILE - 8, TILE - 8)
        ctx.strokeStyle = '#444'; ctx.lineWidth = 2
        ctx.beginPath(); ctx.moveTo(bx + 8, by + 8); ctx.lineTo(bx + TILE - 8, by + TILE - 8)
        ctx.moveTo(bx + TILE - 8, by + 8); ctx.lineTo(bx + 8, by + TILE - 8); ctx.stroke()
      }

      // ---- player ----
      if (state !== 'over') {
        const blink = shieldTimer > 0 && Math.floor(performance.now() / 100) % 2 === 0
        drawTank(player, blink ? '#fff' : PINK, PINK)
        if (shieldTimer > 0) {
          ctx.strokeStyle = 'rgba(45,226,230,0.8)'; ctx.lineWidth = 2
          ctx.beginPath()
          ctx.arc(player.x + player.w / 2, player.y + player.h / 2, player.w * 0.7, 0, Math.PI * 2)
          ctx.stroke()
        }
      }

      // ---- enemies ----
      for (const e of enemies) {
        const col = e.kind === 'cyan' ? '#2de2e6' : e.kind === 'purple' ? '#b14aed' : '#ff8a1e'
        drawTank(e, col, col)
        if (e.carrier) {
          ctx.fillStyle = `rgba(255,214,10,${Math.floor(performance.now() / 150) % 2 ? 0.9 : 0.3})`
          ctx.beginPath(); ctx.arc(e.x + e.w / 2, e.y - 2, 3, 0, Math.PI * 2); ctx.fill()
        }
      }

      // ---- powerups ----
      for (const p of powerups) {
        const flash = Math.floor(performance.now() / 200) % 2 === 0
        ctx.save()
        ctx.shadowColor = '#ffd60a'; ctx.shadowBlur = flash ? 14 : 6
        ctx.fillStyle = '#1a1608'
        roundRect(p.x, p.y, p.w, p.h, 5); ctx.fill()
        ctx.fillStyle = '#ffd60a'
        ctx.font = '700 16px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        const sym = p.kind === 'star' ? '★' : p.kind === 'helmet' ? '⛑' : p.kind === 'grenade' ? '✸' : '⛏'
        ctx.fillText(sym, p.x + p.w / 2, p.y + p.h / 2 + 1)
        ctx.textBaseline = 'alphabetic'
        ctx.restore()
      }

      // ---- bullets (white glow) ----
      ctx.save()
      ctx.shadowColor = '#fff'; ctx.shadowBlur = 12
      for (const b of bullets) {
        ctx.fillStyle = b.owner === 'player' ? '#fff' : '#ffd0d0'
        ctx.beginPath(); ctx.arc(b.x + b.w / 2, b.y + b.h / 2, b.w / 2 + 1, 0, Math.PI * 2); ctx.fill()
      }
      ctx.restore()

      // ---- forest (drawn over tanks to hide them) ----
      for (const [x, y] of forestCells) {
        ctx.fillStyle = 'rgba(20,60,25,0.92)'
        ctx.fillRect(x, y, TILE, TILE)
        ctx.fillStyle = '#1f7a35'
        for (let i = 0; i < 5; i++) {
          const gx = x + 6 + (i % 3) * 12, gy = y + 8 + Math.floor(i / 3) * 16
          ctx.beginPath(); ctx.arc(gx, gy, 6, 0, Math.PI * 2); ctx.fill()
        }
      }

      // ---- effects ----
      for (const fx of effects) {
        const a = Math.max(0, fx.t * 3)
        ctx.save()
        ctx.shadowColor = fx.col; ctx.shadowBlur = 14
        ctx.fillStyle = fx.col
        ctx.globalAlpha = Math.min(1, a)
        const rad = 18 * (1 - fx.t)
        ctx.beginPath(); ctx.arc(fx.x, fx.y, 6 + rad, 0, Math.PI * 2); ctx.fill()
        ctx.restore()
      }

      // corner sparkles
      sparkle(20, HUD + 16, 5)
      sparkle(W - 20, H - 18, 4)

      // ---- overlays ----
      if (state === 'ready') overlay('TANKS', 'arrows / WASD move · space fire · defend the base')
      else if (state === 'over') overlay(base.alive ? 'GAME OVER' : 'BASE DESTROYED', 'tap / space to play again')
      else if (state === 'levelclear') overlay('LEVEL ' + level + ' CLEAR', 'next wave incoming…')
    }

    function overlay(title, sub) {
      ctx.fillStyle = 'rgba(10,10,10,0.8)'
      ctx.fillRect(0, HUD, W, H - HUD)
      ctx.textAlign = 'center'
      ctx.fillStyle = PINK; ctx.font = '800 34px system-ui, sans-serif'
      ctx.fillText(title.toUpperCase(), W / 2, H / 2 - 6)
      ctx.fillStyle = PINK; ctx.fillRect(W / 2 - 70, H / 2 + 6, 140, 4)
      ctx.fillStyle = '#fff'; ctx.font = '600 13px system-ui, sans-serif'
      ctx.fillText(sub, W / 2, H / 2 + 34)
    }

    // ---------- autoplay round control ----------
    function newRound() {
      reset()
      wantWin = shouldAutoWin('tanks')
      clearedSession = false
      recorded = false
      state = 'playing'
      botFireCool = 0
    }

    function loop(now) {
      let dt = (now - last) / 1000
      last = now
      if (dt > 0.05) dt = 0.05 // clamp delta

      if (playerShotCool > 0) playerShotCool -= dt

      if (auto) {
        if (state === 'ready') state = 'playing'
        else if (state === 'over') {
          if (!restartAt) restartAt = now + 1600
          else if (now >= restartAt) { restartAt = 0; newRound() }
        }
        if (state === 'playing') botStep(dt)
      }

      update(dt)
      draw()
      raf = requestAnimationFrame(loop)
    }

    if (auto) newRound(); else reset()
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
      canvas.removeEventListener('pointerdown', onPointer)
      if (restartTO) clearTimeout(restartTO)
    }
  }, [])

  return (
    <canvas ref={canvasRef} width={W} height={H} className="tanks-canvas" aria-label="Tanks game" />
  )
}
