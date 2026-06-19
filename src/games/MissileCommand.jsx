import { useEffect, useRef } from 'react'
import { isAutoplay, shouldAutoWin, recordAutoplayResult } from '../autoplay.js'

// Missile Command on canvas, 10x neon style.
// Click to launch an interceptor from the nearest battery; it explodes on arrival
// and destroys enemy missiles it touches. Defend the cities. Waves escalate.
const W = 640
const H = 480

const GROUND_Y = H - 40
const CITY_COUNT = 6
const CITY_W = 46
const CITY_H = 26

const BATTERY_AMMO = 10        // interceptors per battery, refills each wave
const INTERCEPTOR_SPEED = 460  // px/s
const EXPLOSION_MAX_R = 36
const EXPLOSION_GROW = 90      // px/s radius growth
const EXPLOSION_SHRINK = 60    // px/s radius shrink

const PINK = '#ff2d6f'
const CYAN = '#2de2e6'
const ORANGE = '#ff8a1e'
const MUTED = '#8a93ad'

const BEST_KEY = '10xgames.missile.best'

export default function MissileCommand() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')

    const auto = isAutoplay('missile-command')
    let wantWin = auto ? shouldAutoWin('missile-command') : false  // current round goal (autoplay)
    let restartTimer = 0                // counts down after game over (autoplay)
    let botCooldown = 0                 // throttle between interceptor launches (autoplay)
    let maxWave = 1                     // deepest wave reached this session (autoplay)
    let recorded = false               // ensure one record per game-over (autoplay)

    let cities, batteries, enemies, interceptors, explosions, stars
    let score, wave, state, best
    let spawnTimer, toSpawn, spawnGap
    let last = performance.now(), raf = 0

    best = Number(localStorage.getItem(BEST_KEY)) || 0

    // battery X positions: edges + center; cities fill the gaps
    const batteryX = [40, W / 2, W - 40]

    function makeStars() {
      const arr = []
      for (let i = 0; i < 40; i++) {
        arr.push({ x: Math.random() * W, y: Math.random() * (GROUND_Y - 20), r: Math.random() * 1.4 + 0.3 })
      }
      return arr
    }

    function makeCities() {
      // place 6 cities in the spans between the 3 batteries (3 per left/right span -> 6)
      const arr = []
      const spans = [[batteryX[0], batteryX[1]], [batteryX[1], batteryX[2]]]
      for (const [a, b] of spans) {
        const inner = b - a
        for (let i = 1; i <= 3; i++) {
          const cx = a + (inner * i) / 4
          arr.push({ x: cx, alive: true, seed: Math.random() })
        }
      }
      return arr
    }

    function makeBatteries() {
      return batteryX.map((x) => ({ x, ammo: BATTERY_AMMO }))
    }

    function startWave(n) {
      wave = n
      if (n > maxWave) maxWave = n
      toSpawn = 6 + n * 3
      spawnGap = Math.max(0.35, 1.4 - n * 0.12)
      spawnTimer = 0.4
      for (const b of batteries) b.ammo = BATTERY_AMMO
    }

    function newGame() {
      stars = makeStars()
      cities = makeCities()
      batteries = makeBatteries()
      enemies = []
      interceptors = []
      explosions = []
      score = 0
      maxWave = 1
      recorded = false
      startWave(1)
      state = 'ready'
    }

    function targets() {
      // valid ground targets enemy missiles can aim at: alive cities + batteries
      const t = []
      for (const c of cities) if (c.alive) t.push(c.x)
      for (const b of batteries) t.push(b.x)
      return t
    }

    function spawnEnemy() {
      const tg = targets()
      if (tg.length === 0) return
      const sx = Math.random() * W
      const tx = tg[(Math.random() * tg.length) | 0]
      const ty = GROUND_Y
      const dx = tx - sx, dy = ty
      const len = Math.hypot(dx, dy) || 1
      const speed = 38 + wave * 7 + Math.random() * 20
      enemies.push({
        sx, sy: 0, x: sx, y: 0,
        vx: (dx / len) * speed, vy: (dy / len) * speed,
        tx, alive: true, engagedUntil: 0,
      })
    }

    function launchInterceptor(tx, ty) {
      // pick nearest battery with ammo
      let best = null, bd = Infinity
      for (const b of batteries) {
        if (b.ammo <= 0) continue
        const d = Math.abs(b.x - tx)
        if (d < bd) { bd = d; best = b }
      }
      if (!best) return
      best.ammo--
      const sx = best.x, sy = GROUND_Y
      const dx = tx - sx, dy = ty - sy
      const len = Math.hypot(dx, dy) || 1
      interceptors.push({
        x: sx, y: sy,
        vx: (dx / len) * INTERCEPTOR_SPEED, vy: (dy / len) * INTERCEPTOR_SPEED,
        tx, ty,
      })
    }

    function addExplosion(x, y) {
      explosions.push({ x, y, r: 2, phase: 'grow' })
    }

    function endCheck() {
      if (cities.every((c) => !c.alive)) {
        state = 'over'
        restartTimer = 1.3
        if (score > best) { best = score; localStorage.setItem(BEST_KEY, String(best)) }
      }
    }

    // ---------- autoplay bot ----------
    // Drives the game by calling launchInterceptor (the game's own fire function).
    // Good rounds: intercept aggressively and lead the target so cities survive.
    // Sloppy rounds: fire rarely / late / off-target so cities get destroyed.
    function predictedImpactTime(e) {
      // time until this enemy reaches the ground
      return e.vy > 0 ? (GROUND_Y - e.y) / e.vy : Infinity
    }
    function threatensCity(e) {
      // is this missile aimed at (or heading toward) a still-standing city?
      for (const c of cities) {
        if (c.alive && Math.abs(e.tx - c.x) < CITY_W / 2 + 6) return true
      }
      return false
    }
    function nearestBatteryX(x) {
      let bx = null, bd = Infinity
      for (const b of batteries) {
        if (b.ammo <= 0) continue
        const d = Math.abs(b.x - x)
        if (d < bd) { bd = d; bx = b.x }
      }
      return bx
    }
    // Solve for the lead time at which an interceptor fired now meets enemy e.
    // The explosion forms when the interceptor reaches the aim point, so we aim
    // where the enemy will be after the interceptor's own flight time.
    function interceptPoint(e) {
      const bx = nearestBatteryX(e.x)
      if (bx == null) return null
      let t = 0.15
      for (let i = 0; i < 6; i++) {
        const px = e.x + e.vx * t
        const py = e.y + e.vy * t
        const flight = Math.hypot(px - bx, py - GROUND_Y) / INTERCEPTOR_SPEED
        t = flight
      }
      const ix = e.x + e.vx * t
      const iy = e.y + e.vy * t
      if (iy >= GROUND_Y - 8) return null   // would only meet at the ground -> too late
      return { ix, iy }
    }
    function botStep(dt) {
      if (state === 'ready') { state = 'playing'; return }
      if (state === 'over') {
        if (!recorded) {
          recorded = true
          const survived = cities.some((c) => c.alive)
          recordAutoplayResult('missile-command', maxWave >= 5 && survived)
        }
        restartTimer -= dt
        if (restartTimer <= 0) {
          wantWin = shouldAutoWin('missile-command')
          newGame()
          state = 'playing'
        }
        return
      }
      if (state !== 'playing') return

      botCooldown -= dt
      if (botCooldown > 0) return

      if (wantWin) {
        // aggressive + accurate: engage the most-threatening un-engaged missile and
        // lead it so the blast lands exactly where it will be. Re-engage if a prior
        // shot's window has elapsed without a kill.
        let target = null, bestScore = Infinity
        for (const e of enemies) {
          if (!e.alive) continue
          if (e.engagedUntil && e.engagedUntil > 0) continue   // already covered by an in-flight shot
          const tti = predictedImpactTime(e)
          // prioritise city threats, then soonest impact
          const score = tti - (threatensCity(e) ? 1.5 : 0)
          if (score < bestScore) { bestScore = score; target = e }
        }
        // age existing engagements so missed shots free the target up again
        for (const e of enemies) {
          if (e.engagedUntil > 0) e.engagedUntil -= dt
        }
        if (target) {
          const aim = interceptPoint(target)
          if (aim) {
            launchInterceptor(aim.ix, aim.iy)
            target.engagedUntil = 0.45   // covered for this long, then re-evaluate
          }
          botCooldown = 0.1               // smooth, rapid engagement
        } else {
          botCooldown = 0.05
        }
      } else {
        // sloppy: rarely fire, late, and off-target so cities fall
        let target = null, soonest = Infinity
        for (const e of enemies) {
          if (!e.alive) continue
          const tti = predictedImpactTime(e)
          if (tti < soonest) { soonest = tti; target = e }
        }
        if (target && Math.random() < 0.15 && soonest < 0.4) {
          const ix = target.x + (Math.random() - 0.5) * 120
          const iy = target.y + (Math.random() - 0.5) * 120
          launchInterceptor(ix, iy)
        }
        botCooldown = 0.6
      }
    }

    function update(dt) {
      if (auto) botStep(dt)
      if (state !== 'playing') return

      // spawn enemies for this wave
      if (toSpawn > 0) {
        spawnTimer -= dt
        if (spawnTimer <= 0) {
          spawnEnemy()
          toSpawn--
          spawnTimer = spawnGap
        }
      }

      // interceptors
      for (const it of interceptors) {
        if (it.done) continue
        it.x += it.vx * dt
        it.y += it.vy * dt
        // reached target?
        const dx = it.tx - it.x, dy = it.ty - it.y
        if (dx * it.vx + dy * it.vy <= 0) { // passed target
          it.done = true
          addExplosion(it.tx, it.ty)
        }
      }
      interceptors = interceptors.filter((it) => !it.done)

      // explosions grow/shrink
      for (const ex of explosions) {
        if (ex.phase === 'grow') {
          ex.r += EXPLOSION_GROW * dt
          if (ex.r >= EXPLOSION_MAX_R) { ex.r = EXPLOSION_MAX_R; ex.phase = 'shrink' }
        } else {
          ex.r -= EXPLOSION_SHRINK * dt
        }
      }

      // enemy missiles move + collide with explosions
      for (const e of enemies) {
        if (!e.alive) continue
        e.x += e.vx * dt
        e.y += e.vy * dt
        // explosion collision (chain)
        for (const ex of explosions) {
          const d = Math.hypot(e.x - ex.x, e.y - ex.y)
          if (d <= ex.r) {
            e.alive = false
            score += 25
            addExplosion(e.x, e.y) // chain explosion at impact
            break
          }
        }
        if (!e.alive) continue
        // hit ground / target
        if (e.y >= GROUND_Y) {
          e.alive = false
          // destroy nearest city if close
          for (const c of cities) {
            if (c.alive && Math.abs(c.x - e.x) < CITY_W / 2 + 6) { c.alive = false; break }
          }
          addExplosion(e.x, GROUND_Y)
        }
      }

      explosions = explosions.filter((ex) => ex.r > 0)
      enemies = enemies.filter((e) => e.alive)

      endCheck()
      if (state !== 'playing') return

      // wave complete: all spawned, none left, explosions cleared
      if (toSpawn === 0 && enemies.length === 0 && explosions.length === 0) {
        // bonus for surviving cities
        const survivors = cities.filter((c) => c.alive).length
        score += survivors * 100
        // autoplay: a winning session = cleared wave >= 5 with a city alive -> end the run as a win
        if (auto && wave >= 5 && survivors > 0) {
          state = 'over'
          restartTimer = 1.3
          if (score > best) { best = score; localStorage.setItem(BEST_KEY, String(best)) }
        } else {
          startWave(wave + 1)
          state = 'playing'
        }
      }
    }

    // ---------- input ----------
    function onKeyDown(e) {
      if (e.code === 'Space') {
        e.preventDefault()
        if (state === 'ready') state = 'playing'
        else if (state === 'over') newGame()
      }
    }
    function onPointerDown(e) {
      const rect = canvas.getBoundingClientRect()
      const x = (e.clientX - rect.left) * (W / rect.width)
      const y = (e.clientY - rect.top) * (H / rect.height)
      if (state === 'ready') { state = 'playing'; return }
      if (state === 'over') { newGame(); return }
      if (y < GROUND_Y) launchInterceptor(x, y)
    }
    window.addEventListener('keydown', onKeyDown)
    canvas.addEventListener('pointerdown', onPointerDown)

    // ---------- drawing ----------
    function sparkle(x, y, s) {
      ctx.strokeStyle = PINK; ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(x - s, y); ctx.lineTo(x + s, y); ctx.moveTo(x, y - s); ctx.lineTo(x, y + s); ctx.stroke()
    }
    function label(x, y, text, value, align) {
      ctx.textAlign = align || 'left'
      ctx.fillStyle = PINK; ctx.font = '700 11px system-ui, sans-serif'
      ctx.fillText(text, x, y)
      const barX = align === 'right' ? x - 22 : align === 'center' ? x - 11 : x
      ctx.fillRect(barX, y + 4, 22, 3)
      ctx.fillStyle = '#fff'; ctx.font = '800 20px system-ui, sans-serif'
      ctx.fillText(String(value), x, y + 26)
    }

    function drawCity(c) {
      if (!c.alive) {
        // rubble
        ctx.fillStyle = MUTED
        ctx.fillRect(c.x - CITY_W / 2, GROUND_Y - 5, CITY_W, 5)
        return
      }
      ctx.save()
      ctx.shadowColor = CYAN; ctx.shadowBlur = 12
      ctx.fillStyle = CYAN
      const x0 = c.x - CITY_W / 2
      // blocky skyline: a few towers of varying height
      const heights = [0.5, 0.85, 0.65, 1.0, 0.6, 0.8]
      const cols = 6
      const cw = CITY_W / cols
      for (let i = 0; i < cols; i++) {
        const h = CITY_H * (heights[(i + Math.floor(c.seed * 6)) % cols])
        ctx.fillRect(x0 + i * cw + 1, GROUND_Y - h, cw - 2, h)
      }
      ctx.restore()
    }

    function drawBattery(b) {
      ctx.save()
      ctx.shadowColor = PINK; ctx.shadowBlur = 10
      ctx.fillStyle = PINK
      ctx.beginPath()
      ctx.moveTo(b.x - 14, GROUND_Y)
      ctx.lineTo(b.x + 14, GROUND_Y)
      ctx.lineTo(b.x + 8, GROUND_Y - 16)
      ctx.lineTo(b.x - 8, GROUND_Y - 16)
      ctx.closePath(); ctx.fill()
      ctx.restore()
      // ammo readout
      ctx.fillStyle = b.ammo > 0 ? CYAN : MUTED
      ctx.font = '700 10px system-ui, sans-serif'; ctx.textAlign = 'center'
      ctx.fillText(String(b.ammo), b.x, GROUND_Y + 16)
    }

    function draw() {
      ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, W, H)

      // stars
      ctx.fillStyle = 'rgba(255,255,255,0.55)'
      for (const s of stars) { ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill() }

      sparkle(24, 26, 5); sparkle(W - 24, H - 22, 4)

      // ground line
      ctx.strokeStyle = 'rgba(45,226,230,0.35)'; ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(0, GROUND_Y); ctx.lineTo(W, GROUND_Y); ctx.stroke()

      // cities + batteries
      for (const c of cities) drawCity(c)
      for (const b of batteries) drawBattery(b)

      // enemy missile trails (red/orange) with moving head
      ctx.lineWidth = 2
      for (const e of enemies) {
        ctx.strokeStyle = ORANGE
        ctx.beginPath(); ctx.moveTo(e.sx, e.sy); ctx.lineTo(e.x, e.y); ctx.stroke()
        ctx.save()
        ctx.shadowColor = '#ff3b1e'; ctx.shadowBlur = 10
        ctx.fillStyle = '#ff3b1e'
        ctx.beginPath(); ctx.arc(e.x, e.y, 3, 0, Math.PI * 2); ctx.fill()
        ctx.restore()
      }

      // interceptor trails (pink) with head
      for (const it of interceptors) {
        const bx = batteries.reduce((p, b) => Math.abs(b.x - it.tx) < Math.abs(p - it.tx) ? b.x : p, batteries[0].x)
        ctx.strokeStyle = PINK
        ctx.beginPath(); ctx.moveTo(bx, GROUND_Y); ctx.lineTo(it.x, it.y); ctx.stroke()
        ctx.save()
        ctx.shadowColor = PINK; ctx.shadowBlur = 10
        ctx.fillStyle = '#fff'
        ctx.beginPath(); ctx.arc(it.x, it.y, 2.5, 0, Math.PI * 2); ctx.fill()
        ctx.restore()
        // target marker
        ctx.strokeStyle = 'rgba(255,45,111,0.6)'
        ctx.beginPath()
        ctx.moveTo(it.tx - 4, it.ty); ctx.lineTo(it.tx + 4, it.ty)
        ctx.moveTo(it.tx, it.ty - 4); ctx.lineTo(it.tx, it.ty + 4)
        ctx.stroke()
      }

      // explosions (glowing orange/yellow)
      for (const ex of explosions) {
        ctx.save()
        ctx.shadowColor = ORANGE; ctx.shadowBlur = 24
        const g = ctx.createRadialGradient(ex.x, ex.y, 0, ex.x, ex.y, Math.max(1, ex.r))
        g.addColorStop(0, 'rgba(255,255,180,0.95)')
        g.addColorStop(0.5, 'rgba(255,138,30,0.85)')
        g.addColorStop(1, 'rgba(255,59,30,0.15)')
        ctx.fillStyle = g
        ctx.beginPath(); ctx.arc(ex.x, ex.y, ex.r, 0, Math.PI * 2); ctx.fill()
        ctx.restore()
      }

      // HUD
      const citiesLeft = cities.filter((c) => c.alive).length
      label(16, 26, 'SCORE', score, 'left')
      label(W / 2, 26, 'CITIES', citiesLeft, 'center')
      label(W - 16, 26, 'BEST', best, 'right')

      // wave hint
      ctx.fillStyle = MUTED; ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'center'
      ctx.fillText('WAVE ' + wave + '   ·   click to intercept', W / 2, H - 12)

      if (state === 'ready') overlay('MISSILE COMMAND', 'space / tap to start')
      else if (state === 'over') overlay('GAME OVER', 'space / tap to play again')
    }

    function overlay(title, sub) {
      ctx.fillStyle = 'rgba(10,10,10,0.78)'; ctx.fillRect(0, H / 2 - 70, W, 140)
      ctx.textAlign = 'center'
      ctx.fillStyle = PINK; ctx.font = '800 38px system-ui, sans-serif'
      ctx.fillText(title, W / 2, H / 2)
      ctx.fillStyle = PINK; ctx.fillRect(W / 2 - 70, H / 2 + 12, 140, 4)
      ctx.fillStyle = '#fff'; ctx.font = '600 14px system-ui, sans-serif'
      ctx.fillText(sub, W / 2, H / 2 + 42)
    }

    function loop(now) {
      let dt = (now - last) / 1000; last = now
      if (dt > 0.05) dt = 0.05
      update(dt)
      draw()
      raf = requestAnimationFrame(loop)
    }

    newGame()
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKeyDown)
      canvas.removeEventListener('pointerdown', onPointerDown)
    }
  }, [])

  return (
    <canvas ref={canvasRef} width={W} height={H} className="missile-canvas" aria-label="Missile Command game" />
  )
}
