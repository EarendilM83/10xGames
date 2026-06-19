import { useEffect, useRef } from 'react'
import { isAutoplay, shouldAutoWin, recordAutoplayResult } from '../autoplay.js'

// Tower Defense on canvas, 10x neon style.
// Enemies walk a fixed winding path from spawn to base. Place towers on empty tiles
// to shoot them. Survive the waves. Money buys towers, lives drop when enemies reach base.
const W = 640
const H = 560

// --- grid / layout ---
const TILE = 40
const HUD_W = 160                // right-side HUD panel width
const GRID_W = W - HUD_W         // 480 -> 12 cols
const COLS = GRID_W / TILE       // 12
const ROWS = H / TILE            // 14

// Winding path as a sequence of grid cells (col,row). Spawn at left edge, base at right.
const PATH_CELLS = [
  [0, 1], [1, 1], [2, 1], [3, 1], [4, 1],
  [4, 2], [4, 3], [4, 4],
  [3, 4], [2, 4], [1, 4],
  [1, 5], [1, 6], [1, 7],
  [2, 7], [3, 7], [4, 7], [5, 7], [6, 7], [7, 7],
  [7, 6], [7, 5], [7, 4], [7, 3],
  [8, 3], [9, 3], [10, 3],
  [10, 4], [10, 5], [10, 6], [10, 7], [10, 8], [10, 9], [10, 10],
  [9, 10], [8, 10], [7, 10], [6, 10], [5, 10], [4, 10], [3, 10],
  [3, 11], [3, 12], [3, 13],
]

const cellCenter = (c, r) => ({ x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 })

// Waypoints in pixels (centers of path cells).
const WAYPOINTS = PATH_CELLS.map(([c, r]) => cellCenter(c, r))

// Lookup set for "is this cell on the path".
const pathKeySet = new Set(PATH_CELLS.map(([c, r]) => c + ',' + r))

const WAVES_TO_WIN = 12

// --- tower definitions ---
const TOWERS = {
  1: { name: 'RAPID', cost: 50, range: 95, dmg: 6, rate: 0.18, color: '#2de2e6', proj: '#9ffcff', splash: 0, pspeed: 460 },
  2: { name: 'CANNON', cost: 90, range: 130, dmg: 34, rate: 0.95, color: '#ff2d6f', proj: '#ff89b0', splash: 0, pspeed: 360 },
  3: { name: 'SPLASH', cost: 120, range: 110, dmg: 16, rate: 0.7, color: '#b14aed', proj: '#d79cff', splash: 46, pspeed: 320 },
}

const PINK = '#ff2d6f'
const CYAN = '#2de2e6'
const PURPLE = '#b14aed'
const GOLD = '#ffd60a'
const MUTED = '#8a93ad'

const BEST_KEY = '10xgames.td.best'

export default function TowerDefense() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const auto = isAutoplay('tower-defense')

    let towers, enemies, projectiles, effects
    let money, lives, wave, score, state, best
    let selected           // selected tower type (1..3)
    let phase              // 'build' | 'wave'
    let toSpawn, spawnTimer, spawnGap, waveSpec
    let hover              // {col,row} or null
    let last = performance.now(), raf = 0

    best = Number(localStorage.getItem(BEST_KEY)) || 0

    function waveConfig(n) {
      // escalating: more enemies, more HP, occasional fast/tank waves
      const fast = n % 3 === 0
      const tank = n % 4 === 0
      const count = 6 + n * 2
      const hp = Math.round((20 + n * 12) * (tank ? 1.9 : 1))
      const speed = (52 + n * 2) * (fast ? 1.7 : 1)
      const reward = 6 + Math.floor(n * 0.8) + (tank ? 6 : 0)
      const gap = Math.max(0.35, 1.1 - n * 0.04)
      return { count, hp, speed, reward, gap, fast, tank }
    }

    function startWave() {
      waveSpec = waveConfig(wave)
      toSpawn = waveSpec.count
      spawnGap = waveSpec.gap
      spawnTimer = 0.2
      phase = 'wave'
    }

    function newGame() {
      towers = []
      enemies = []
      projectiles = []
      effects = []
      money = 120
      lives = 20
      wave = 1
      score = 0
      selected = 1
      phase = 'build'
      hover = null
      waveSpec = waveConfig(wave)
      state = 'playing'
    }

    function spawnEnemy() {
      const start = WAYPOINTS[0]
      enemies.push({
        x: start.x, y: start.y,
        seg: 0,                 // current waypoint index we are moving toward
        hp: waveSpec.hp, maxHp: waveSpec.hp,
        speed: waveSpec.speed,
        reward: waveSpec.reward,
        fast: waveSpec.fast, tank: waveSpec.tank,
        alive: true,
      })
    }

    function cellFree(col, row) {
      if (col < 0 || row < 0 || col >= COLS || row >= ROWS) return false
      if (pathKeySet.has(col + ',' + row)) return false
      for (const t of towers) if (t.col === col && t.row === row) return false
      return true
    }

    function placeTower(col, row) {
      const spec = TOWERS[selected]
      if (!spec) return
      if (!cellFree(col, row)) return
      if (money < spec.cost) return
      money -= spec.cost
      const c = cellCenter(col, row)
      towers.push({ col, row, x: c.x, y: c.y, type: selected, cd: 0 })
    }

    function fireTower(t) {
      const spec = TOWERS[t.type]
      // target: the enemy furthest along the path (highest seg, then closest to next wp) within range
      let target = null, bestProgress = -1
      for (const e of enemies) {
        if (!e.alive) continue
        const d = Math.hypot(e.x - t.x, e.y - t.y)
        if (d > spec.range) continue
        // progress = waypoint index reached; ties broken arbitrarily (fine)
        if (e.seg > bestProgress) { bestProgress = e.seg; target = e }
      }
      if (!target) return
      const dx = target.x - t.x, dy = target.y - t.y
      const len = Math.hypot(dx, dy) || 1
      projectiles.push({
        x: t.x, y: t.y,
        vx: (dx / len) * spec.pspeed, vy: (dy / len) * spec.pspeed,
        dmg: spec.dmg, splash: spec.splash, color: spec.proj,
        target,
        alive: true,
      })
      t.cd = spec.rate
    }

    function damageEnemy(e, dmg) {
      e.hp -= dmg
      if (e.hp <= 0 && e.alive) {
        e.alive = false
        money += e.reward
        score += e.reward * 2
        effects.push({ x: e.x, y: e.y, r: 4, max: 22, color: e.tank ? PINK : CYAN, kind: 'kill' })
      }
    }

    function update(dt) {
      if (state !== 'playing') return

      // spawn during wave
      if (phase === 'wave' && toSpawn > 0) {
        spawnTimer -= dt
        if (spawnTimer <= 0) {
          spawnEnemy()
          toSpawn--
          spawnTimer = spawnGap
        }
      }

      // move enemies along waypoints
      for (const e of enemies) {
        if (!e.alive) continue
        let move = e.speed * dt
        while (move > 0 && e.seg < WAYPOINTS.length - 1) {
          const next = WAYPOINTS[e.seg + 1]
          const dx = next.x - e.x, dy = next.y - e.y
          const dist = Math.hypot(dx, dy)
          if (dist <= move) {
            e.x = next.x; e.y = next.y; e.seg++
            move -= dist
          } else {
            e.x += (dx / dist) * move
            e.y += (dy / dist) * move
            move = 0
          }
        }
        // reached base
        if (e.seg >= WAYPOINTS.length - 1) {
          e.alive = false
          lives--
          effects.push({ x: e.x, y: e.y, r: 4, max: 26, color: PINK, kind: 'leak' })
          if (lives <= 0) {
            lives = 0
            state = 'over'
            const reached = wave
            if (reached > best) { best = reached; localStorage.setItem(BEST_KEY, String(best)) }
          }
        }
      }

      // towers fire
      for (const t of towers) {
        t.cd -= dt
        if (t.cd <= 0) fireTower(t)
      }

      // projectiles
      for (const p of projectiles) {
        if (!p.alive) continue
        p.x += p.vx * dt
        p.y += p.vy * dt
        // off screen
        if (p.x < -20 || p.x > GRID_W + 20 || p.y < -20 || p.y > H + 20) { p.alive = false; continue }
        // hit detection: against its target (and any enemy it grazes)
        let hit = null
        for (const e of enemies) {
          if (!e.alive) continue
          if (Math.hypot(e.x - p.x, e.y - p.y) <= 12) { hit = e; break }
        }
        if (hit) {
          if (p.splash > 0) {
            // splash damage to all in radius
            effects.push({ x: p.x, y: p.y, r: 6, max: p.splash, color: PURPLE, kind: 'splash' })
            for (const e of enemies) {
              if (!e.alive) continue
              if (Math.hypot(e.x - p.x, e.y - p.y) <= p.splash) damageEnemy(e, p.dmg)
            }
          } else {
            damageEnemy(hit, p.dmg)
            effects.push({ x: p.x, y: p.y, r: 2, max: 10, color: p.color, kind: 'hit' })
          }
          p.alive = false
        }
      }

      // effects expand+fade
      for (const fx of effects) {
        fx.r += (fx.max - fx.r) * Math.min(1, dt * 9) + fx.max * dt * 0.6
        fx.life = (fx.life || 0) + dt
      }

      enemies = enemies.filter((e) => e.alive)
      projectiles = projectiles.filter((p) => p.alive)
      effects = effects.filter((fx) => (fx.life || 0) < 0.4)

      // wave cleared?
      if (phase === 'wave' && toSpawn === 0 && enemies.length === 0) {
        // end-of-wave bonus
        money += 20 + wave * 4
        score += 50 + wave * 10
        if (wave >= WAVES_TO_WIN) {
          state = 'win'
          const reached = wave
          if (reached > best) { best = reached; localStorage.setItem(BEST_KEY, String(best)) }
          return
        }
        wave++
        waveSpec = waveConfig(wave)
        phase = 'build'
      }
    }

    // ---------- input ----------
    function onKeyDown(e) {
      if (e.code === 'Digit1') selected = 1
      else if (e.code === 'Digit2') selected = 2
      else if (e.code === 'Digit3') selected = 3
      else if (e.code === 'Space') {
        e.preventDefault()
        if (state === 'over' || state === 'win') { newGame(); return }
        if (state === 'playing' && phase === 'build') startWave()
      }
    }

    function pointFromEvent(e) {
      const rect = canvas.getBoundingClientRect()
      return {
        x: (e.clientX - rect.left) * (W / rect.width),
        y: (e.clientY - rect.top) * (H / rect.height),
      }
    }

    function onPointerMove(e) {
      const p = pointFromEvent(e)
      if (p.x >= GRID_W) { hover = null; return }
      hover = { col: Math.floor(p.x / TILE), row: Math.floor(p.y / TILE) }
    }

    function onPointerDown(e) {
      const p = pointFromEvent(e)
      if (state === 'over' || state === 'win') { newGame(); return }

      // HUD palette click? buttons live in the right panel.
      if (p.x >= GRID_W) {
        const idx = hudButtonAt(p.x, p.y)
        if (idx) {
          if (idx === 'start') { if (phase === 'build') startWave() }
          else selected = idx
        }
        return
      }

      // grid placement
      const col = Math.floor(p.x / TILE)
      const row = Math.floor(p.y / TILE)
      placeTower(col, row)
    }

    // palette button geometry (right HUD)
    const PAL_X = GRID_W + 14
    const PAL_W = HUD_W - 28
    const PAL_Y0 = 210
    const PAL_H = 64
    const PAL_GAP = 12
    const START_Y = PAL_Y0 + 3 * (PAL_H + PAL_GAP) + 8
    const START_H = 44

    function hudButtonAt(x, y) {
      for (let i = 0; i < 3; i++) {
        const by = PAL_Y0 + i * (PAL_H + PAL_GAP)
        if (x >= PAL_X && x <= PAL_X + PAL_W && y >= by && y <= by + PAL_H) return i + 1
      }
      if (x >= PAL_X && x <= PAL_X + PAL_W && y >= START_Y && y <= START_Y + START_H) return 'start'
      return null
    }

    function onPointerLeave() { hover = null }
    window.addEventListener('keydown', onKeyDown)
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerleave', onPointerLeave)

    // ---------- drawing ----------
    function sparkle(x, y, s) {
      ctx.strokeStyle = PINK; ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(x - s, y); ctx.lineTo(x + s, y); ctx.moveTo(x, y - s); ctx.lineTo(x, y + s); ctx.stroke()
    }

    function label(x, y, text, value, color) {
      ctx.textAlign = 'left'
      ctx.fillStyle = PINK; ctx.font = '700 11px system-ui, sans-serif'
      ctx.fillText(text, x, y)
      ctx.fillRect(x, y + 4, 22, 3)
      ctx.fillStyle = color || '#fff'; ctx.font = '800 20px system-ui, sans-serif'
      ctx.fillText(String(value), x, y + 26)
    }

    function drawGrid() {
      // buildable tiles subtle grid
      ctx.strokeStyle = 'rgba(138,147,173,0.10)'; ctx.lineWidth = 1
      for (let c = 0; c <= COLS; c++) {
        ctx.beginPath(); ctx.moveTo(c * TILE, 0); ctx.lineTo(c * TILE, H); ctx.stroke()
      }
      for (let r = 0; r <= ROWS; r++) {
        ctx.beginPath(); ctx.moveTo(0, r * TILE); ctx.lineTo(GRID_W, r * TILE); ctx.stroke()
      }
    }

    function drawPath() {
      // darker neon-bordered track: thick line through waypoints
      ctx.save()
      ctx.lineJoin = 'round'; ctx.lineCap = 'round'
      // track fill
      ctx.strokeStyle = '#101522'; ctx.lineWidth = TILE - 6
      ctx.beginPath()
      ctx.moveTo(WAYPOINTS[0].x, WAYPOINTS[0].y)
      for (let i = 1; i < WAYPOINTS.length; i++) ctx.lineTo(WAYPOINTS[i].x, WAYPOINTS[i].y)
      ctx.stroke()
      // neon border
      ctx.shadowColor = CYAN; ctx.shadowBlur = 8
      ctx.strokeStyle = 'rgba(45,226,230,0.45)'; ctx.lineWidth = TILE - 4
      ctx.beginPath()
      ctx.moveTo(WAYPOINTS[0].x, WAYPOINTS[0].y)
      for (let i = 1; i < WAYPOINTS.length; i++) ctx.lineTo(WAYPOINTS[i].x, WAYPOINTS[i].y)
      ctx.globalAlpha = 1
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.restore()

      // spawn marker
      const s = WAYPOINTS[0]
      ctx.save()
      ctx.shadowColor = GOLD; ctx.shadowBlur = 10
      ctx.fillStyle = GOLD; ctx.font = '700 9px system-ui, sans-serif'; ctx.textAlign = 'center'
      ctx.fillText('IN', s.x, s.y + 3)
      ctx.restore()

      // base / exit marker
      const b = WAYPOINTS[WAYPOINTS.length - 1]
      ctx.save()
      ctx.shadowColor = PINK; ctx.shadowBlur = 14
      ctx.strokeStyle = PINK; ctx.lineWidth = 2.5
      ctx.strokeRect(b.x - 15, b.y - 15, 30, 30)
      ctx.fillStyle = PINK; ctx.font = '800 10px system-ui, sans-serif'; ctx.textAlign = 'center'
      ctx.fillText('BASE', b.x, b.y + 3)
      ctx.restore()
    }

    function drawHoverGhost() {
      if (!hover || state !== 'playing') return
      const { col, row } = hover
      const spec = TOWERS[selected]
      const c = cellCenter(col, row)
      const ok = cellFree(col, row) && money >= spec.cost
      ctx.save()
      // range circle
      ctx.beginPath(); ctx.arc(c.x, c.y, spec.range, 0, Math.PI * 2)
      ctx.fillStyle = ok ? 'rgba(45,226,230,0.06)' : 'rgba(255,45,111,0.06)'
      ctx.fill()
      ctx.strokeStyle = ok ? 'rgba(45,226,230,0.5)' : 'rgba(255,45,111,0.5)'
      ctx.lineWidth = 1.5; ctx.stroke()
      // tile highlight
      ctx.fillStyle = ok ? 'rgba(45,226,230,0.18)' : 'rgba(255,45,111,0.18)'
      ctx.fillRect(col * TILE + 2, row * TILE + 2, TILE - 4, TILE - 4)
      ctx.restore()
    }

    function drawTower(t, glow) {
      const spec = TOWERS[t.type]
      ctx.save()
      ctx.shadowColor = spec.color; ctx.shadowBlur = glow ? 16 : 9
      ctx.fillStyle = spec.color
      ctx.beginPath()
      ctx.arc(t.x, t.y, 11, 0, Math.PI * 2)
      ctx.fill()
      // inner core
      ctx.fillStyle = '#0a0a0a'
      ctx.beginPath(); ctx.arc(t.x, t.y, 5, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = spec.color
      ctx.beginPath(); ctx.arc(t.x, t.y, 2.5, 0, Math.PI * 2); ctx.fill()
      ctx.restore()
    }

    function drawEnemy(e) {
      ctx.save()
      const col = e.tank ? PINK : e.fast ? GOLD : '#54e346'
      ctx.shadowColor = col; ctx.shadowBlur = 10
      ctx.fillStyle = col
      const r = e.tank ? 11 : 8
      ctx.beginPath(); ctx.arc(e.x, e.y, r, 0, Math.PI * 2); ctx.fill()
      ctx.restore()
      // hp bar
      const w = 20
      const frac = Math.max(0, e.hp / e.maxHp)
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(e.x - w / 2, e.y - 16, w, 4)
      ctx.fillStyle = frac > 0.5 ? '#54e346' : frac > 0.25 ? GOLD : PINK
      ctx.fillRect(e.x - w / 2, e.y - 16, w * frac, 4)
    }

    function drawProjectile(p) {
      ctx.save()
      ctx.shadowColor = p.color; ctx.shadowBlur = 12
      ctx.fillStyle = '#fff'
      ctx.beginPath(); ctx.arc(p.x, p.y, p.splash > 0 ? 4 : 3, 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = p.color; ctx.lineWidth = 2
      ctx.beginPath(); ctx.arc(p.x, p.y, p.splash > 0 ? 5.5 : 4.5, 0, Math.PI * 2); ctx.stroke()
      ctx.restore()
    }

    function drawEffect(fx) {
      const a = Math.max(0, 1 - (fx.life || 0) / 0.4)
      ctx.save()
      ctx.globalAlpha = a
      ctx.shadowColor = fx.color; ctx.shadowBlur = 18
      ctx.strokeStyle = fx.color; ctx.lineWidth = 2
      ctx.beginPath(); ctx.arc(fx.x, fx.y, fx.r, 0, Math.PI * 2); ctx.stroke()
      ctx.restore()
    }

    function drawHUDPanel() {
      // panel background
      ctx.fillStyle = '#0c0e16'
      ctx.fillRect(GRID_W, 0, HUD_W, H)
      ctx.strokeStyle = 'rgba(138,147,173,0.18)'; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(GRID_W + 0.5, 0); ctx.lineTo(GRID_W + 0.5, H); ctx.stroke()

      sparkle(GRID_W + 18, 16, 4)
      sparkle(W - 14, H - 14, 4)

      const x = GRID_W + 16
      label(x, 30, 'WAVE', wave + '/' + WAVES_TO_WIN, GOLD)
      label(x + 80, 30, 'SCORE', score, '#fff')
      label(x, 78, 'MONEY', '$' + money, money > 0 ? CYAN : MUTED)
      label(x + 80, 78, 'LIVES', lives, lives > 5 ? '#54e346' : PINK)

      // best
      ctx.fillStyle = MUTED; ctx.font = '600 10px system-ui, sans-serif'; ctx.textAlign = 'left'
      ctx.fillText('BEST WAVE: ' + best, x, 116)

      // palette
      ctx.fillStyle = PINK; ctx.font = '700 11px system-ui, sans-serif'
      ctx.fillText('TOWERS', x, 150)
      ctx.fillRect(x, 154, 22, 3)
      ctx.fillStyle = MUTED; ctx.font = '600 9px system-ui, sans-serif'
      ctx.fillText('keys 1-3  ·  click to buy', x, 172)

      for (let i = 1; i <= 3; i++) {
        const spec = TOWERS[i]
        const by = PAL_Y0 + (i - 1) * (PAL_H + PAL_GAP)
        const sel = selected === i
        const afford = money >= spec.cost
        ctx.save()
        ctx.fillStyle = sel ? 'rgba(255,45,111,0.12)' : 'rgba(255,255,255,0.03)'
        ctx.fillRect(PAL_X, by, PAL_W, PAL_H)
        ctx.strokeStyle = sel ? spec.color : 'rgba(138,147,173,0.25)'
        ctx.lineWidth = sel ? 2 : 1
        if (sel) { ctx.shadowColor = spec.color; ctx.shadowBlur = 12 }
        ctx.strokeRect(PAL_X, by, PAL_W, PAL_H)
        ctx.restore()
        // tower icon
        ctx.save()
        ctx.shadowColor = spec.color; ctx.shadowBlur = 8
        ctx.fillStyle = spec.color
        ctx.beginPath(); ctx.arc(PAL_X + 22, by + PAL_H / 2, 10, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = '#0a0a0a'; ctx.beginPath(); ctx.arc(PAL_X + 22, by + PAL_H / 2, 4, 0, Math.PI * 2); ctx.fill()
        ctx.restore()
        // text
        ctx.textAlign = 'left'
        ctx.fillStyle = '#fff'; ctx.font = '700 12px system-ui, sans-serif'
        ctx.fillText(i + '  ' + spec.name, PAL_X + 40, by + 22)
        ctx.fillStyle = afford ? GOLD : MUTED; ctx.font = '700 12px system-ui, sans-serif'
        ctx.fillText('$' + spec.cost, PAL_X + 40, by + 40)
        ctx.fillStyle = MUTED; ctx.font = '600 9px system-ui, sans-serif'
        const tag = spec.splash > 0 ? 'splash' : i === 2 ? 'heavy/slow' : 'rapid'
        ctx.fillText(tag, PAL_X + 40, by + 55)
      }

      // start-wave button
      const canStart = state === 'playing' && phase === 'build'
      ctx.save()
      ctx.fillStyle = canStart ? 'rgba(84,227,70,0.14)' : 'rgba(255,255,255,0.03)'
      ctx.fillRect(PAL_X, START_Y, PAL_W, START_H)
      ctx.strokeStyle = canStart ? '#54e346' : 'rgba(138,147,173,0.25)'
      ctx.lineWidth = canStart ? 2 : 1
      if (canStart) { ctx.shadowColor = '#54e346'; ctx.shadowBlur = 12 }
      ctx.strokeRect(PAL_X, START_Y, PAL_W, START_H)
      ctx.restore()
      ctx.textAlign = 'center'
      ctx.fillStyle = canStart ? '#fff' : MUTED; ctx.font = '800 13px system-ui, sans-serif'
      ctx.fillText(phase === 'build' ? 'START WAVE' : 'WAVE ' + wave, PAL_X + PAL_W / 2, START_Y + 20)
      ctx.fillStyle = MUTED; ctx.font = '600 9px system-ui, sans-serif'
      ctx.fillText('press SPACE', PAL_X + PAL_W / 2, START_Y + 36)
    }

    function draw() {
      ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, W, H)

      drawGrid()
      drawPath()
      drawHoverGhost()

      for (const t of towers) drawTower(t, false)
      for (const e of enemies) drawEnemy(e)
      for (const p of projectiles) drawProjectile(p)
      for (const fx of effects) drawEffect(fx)

      drawHUDPanel()

      // build-phase banner over grid
      if (state === 'playing' && phase === 'build') {
        ctx.textAlign = 'center'
        ctx.fillStyle = MUTED; ctx.font = '600 12px system-ui, sans-serif'
        ctx.fillText('BUILD PHASE — place towers, then SPACE to send wave ' + wave, GRID_W / 2, H - 14)
      }

      if (state === 'over') overlay('GAME OVER', 'reached wave ' + wave + '  ·  space / click to retry')
      else if (state === 'win') overlay('YOU WIN', 'all ' + WAVES_TO_WIN + ' waves cleared  ·  space / click to replay')
    }

    function overlay(title, sub) {
      ctx.fillStyle = 'rgba(10,10,10,0.80)'; ctx.fillRect(0, H / 2 - 70, GRID_W, 140)
      ctx.textAlign = 'center'
      ctx.fillStyle = PINK; ctx.font = '800 38px system-ui, sans-serif'
      ctx.fillText(title, GRID_W / 2, H / 2)
      ctx.fillStyle = PINK; ctx.fillRect(GRID_W / 2 - 70, H / 2 + 12, 140, 4)
      ctx.fillStyle = '#fff'; ctx.font = '600 13px system-ui, sans-serif'
      ctx.fillText(sub, GRID_W / 2, H / 2 + 42)
    }

    function loop(now) {
      let dt = (now - last) / 1000; last = now
      if (dt > 0.05) dt = 0.05
      update(dt)
      draw()
      raf = requestAnimationFrame(loop)
    }

    // ---------- autoplay bot ----------
    // Drives the game's OWN placeTower/startWave/newGame on timers (no synthetic clicks).
    let botTimer = null, restartTimer = null
    let wantWin = true
    let recorded = false       // result recorded for the current game?
    let buildDwell = 0         // build-phase ticks left before sending the wave (watchable)
    let builtThisPhase = false // built defenses for the current build phase yet?

    // Candidate buildable tiles: every empty cell adjacent (incl. diagonals) to a path
    // cell, ranked by how many path waypoints fall within a typical tower range
    // (more coverage first). Static given the fixed path, so compute once.
    function buildCandidates() {
      const seen = new Set()
      const cells = []
      for (const [pc, pr] of PATH_CELLS) {
        for (let dc = -1; dc <= 1; dc++) {
          for (let dr = -1; dr <= 1; dr++) {
            const col = pc + dc, row = pr + dr
            const key = col + ',' + row
            if (seen.has(key)) continue
            seen.add(key)
            if (col < 0 || row < 0 || col >= COLS || row >= ROWS) continue
            if (pathKeySet.has(key)) continue
            const c = cellCenter(col, row)
            // Coverage = number of distinct path waypoints within a strong tower's
            // range. Tiles near corners (where the path doubles back) see many
            // segments at once, so they rank highest = max value per tower.
            let coverage = 0
            for (const wp of WAYPOINTS) {
              if (Math.hypot(wp.x - c.x, wp.y - c.y) <= 120) coverage++
            }
            cells.push({ col, row, coverage })
          }
        }
      }
      cells.sort((a, b) => b.coverage - a.coverage)
      return cells
    }
    const candidates = buildCandidates()

    function pickRoundGoal() {
      // Self-correcting controller in autoplay.js holds the cumulative rate at ~95%.
      wantWin = shouldAutoWin('tower-defense')
    }

    // Place towers for the current build phase. Spends down the available money each
    // phase on the highest-coverage free tiles. Tower mix is tuned so the economy
    // actually supports a win: cheap RAPID towers early give the best damage-per-
    // dollar against low-HP waves and bootstrap the kill-reward income; CANNON
    // (single-target burst for tanks) and SPLASH (groups) come online once richer.
    // A full build with this mix clears all 12 waves with lives to spare.
    function botBuildWin() {
      let placed = true
      while (placed && money >= TOWERS[1].cost) {
        placed = false
        if (wave >= 6 && money >= TOWERS[3].cost) selected = 3
        else if (wave >= 4 && money >= TOWERS[2].cost) selected = 2
        else selected = 1
        const before = towers.length
        for (const cell of candidates) {
          if (cellFree(cell.col, cell.row)) {
            placeTower(cell.col, cell.row)
            if (towers.length > before) { placed = true; break }
          }
        }
      }
    }

    function botBuildLose() {
      // Under-build: at most one cheap, poorly-positioned tower, then rush so
      // enemies leak through and all lives are lost.
      if (towers.length === 0) {
        selected = 1
        for (let i = candidates.length - 1; i >= 0; i--) {
          const cell = candidates[i]
          if (cellFree(cell.col, cell.row)) { placeTower(cell.col, cell.row); break }
        }
      }
    }

    function botTick() {
      if (!auto) return

      // Record the finished session exactly once, then schedule a restart.
      if (state === 'win' || state === 'over') {
        if (!recorded) {
          recorded = true
          recordAutoplayResult('tower-defense', state === 'win')
        }
        if (!restartTimer) {
          restartTimer = setTimeout(() => {
            restartTimer = null
            pickRoundGoal()
            recorded = false
            builtThisPhase = false
            buildDwell = 0
            newGame()
          }, 1500)
        }
        return
      }

      if (state === 'playing' && phase === 'wave') {
        // Wave running — nothing to do; reset build bookkeeping for next phase.
        builtThisPhase = false
        return
      }

      if (state === 'playing' && phase === 'build') {
        if (!builtThisPhase) {
          if (wantWin) botBuildWin()
          else botBuildLose()
          builtThisPhase = true
          // Dwell a couple of ticks so defenses are visibly in place before the
          // wave is sent (watchable, and never rushes a half-built field).
          buildDwell = wantWin ? 3 : 0
        }
        if (buildDwell > 0) { buildDwell--; return }
        startWave()
        builtThisPhase = false
      }
    }

    pickRoundGoal()
    newGame()
    raf = requestAnimationFrame(loop)
    if (auto) botTimer = setInterval(botTick, 250)

    return () => {
      cancelAnimationFrame(raf)
      if (botTimer) clearInterval(botTimer)
      if (restartTimer) clearTimeout(restartTimer)
      window.removeEventListener('keydown', onKeyDown)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerleave', onPointerLeave)
    }
  }, [])

  return (
    <canvas ref={canvasRef} width={W} height={H} className="td-canvas" aria-label="Tower Defense game" />
  )
}
