import { useEffect, useRef } from 'react'
import { isAutoplay, shouldAutoWin, recordAutoplayResult } from '../autoplay.js'

// Asteroids on canvas, 10x neon style. Classic momentum physics, screen wrapping.
const W = 600
const H = 600

const PINK = '#ff2d6f'
const CYAN = '#2de2e6'
const ORANGE = '#ff8a1e'
const BEST_KEY = '10xgames.asteroids.best'

const SHIP_R = 14
const TURN_SPEED = 4.2        // rad/s
const THRUST = 260            // px/s^2
const FRICTION = 0.55         // per second (drift)
const MAX_SPEED = 400
const BULLET_SPEED = 480
const BULLET_LIFE = 0.9       // seconds
const FIRE_COOLDOWN = 0.22
const INVULN_TIME = 2.2

// per asteroid size: radius, score, split count
const SIZES = {
  large: { r: 46, score: 20, next: 'medium' },
  medium: { r: 28, score: 50, next: 'small' },
  small: { r: 16, score: 100, next: null },
}

export default function Asteroids() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')

    const auto = isAutoplay('asteroids')
    let wantWin = auto ? shouldAutoWin('asteroids') : false   // re-rolled each round (auto only)
    let autoRestartAt = 0               // timestamp to auto-restart after game over
    let survived = 0                    // seconds alive this round (win = score>=300 or survived>=20s)
    let recorded = false                // ensure recordAutoplayResult fires once per game over

    let ship, bullets, asteroids, score, lives, wave, state, invuln
    let best = Number(localStorage.getItem(BEST_KEY)) || 0
    const keys = { left: false, right: false, up: false }
    let fireTimer = 0
    let last = performance.now(), raf = 0

    function rand(min, max) { return min + Math.random() * (max - min) }

    function makeAsteroid(x, y, sizeName) {
      const s = SIZES[sizeName]
      const verts = Math.floor(rand(8, 13))
      const offsets = []
      for (let i = 0; i < verts; i++) offsets.push(rand(0.72, 1.18))
      const speed = rand(28, 70) * (sizeName === 'small' ? 1.6 : sizeName === 'medium' ? 1.25 : 1)
      const ang = rand(0, Math.PI * 2)
      return {
        x, y,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        r: s.r,
        size: sizeName,
        verts,
        offsets,
        rot: rand(0, Math.PI * 2),
        spin: rand(-1, 1),
      }
    }

    function spawnWave() {
      const count = 3 + wave
      asteroids = []
      for (let i = 0; i < count; i++) {
        // spawn away from ship center
        let x, y
        do {
          x = rand(0, W); y = rand(0, H)
        } while (Math.hypot(x - W / 2, y - H / 2) < 140)
        asteroids.push(makeAsteroid(x, y, 'large'))
      }
    }

    function resetShip() {
      ship = { x: W / 2, y: H / 2, vx: 0, vy: 0, angle: -Math.PI / 2 }
      invuln = INVULN_TIME
    }

    function newGame() {
      score = 0; lives = 3; wave = 0
      bullets = []
      survived = 0
      recorded = false
      resetShip()
      spawnWave()
      state = 'playing'
    }

    function readyState() {
      score = 0; lives = 3; wave = 0
      bullets = []
      ship = { x: W / 2, y: H / 2, vx: 0, vy: 0, angle: -Math.PI / 2 }
      invuln = 0
      asteroids = []
      // a few drifting rocks for the ready screen backdrop
      for (let i = 0; i < 4; i++) asteroids.push(makeAsteroid(rand(0, W), rand(0, H), 'large'))
      state = 'ready'
    }

    function wrap(o) {
      if (o.x < 0) o.x += W
      else if (o.x > W) o.x -= W
      if (o.y < 0) o.y += H
      else if (o.y > H) o.y -= H
    }

    function fire() {
      if (fireTimer > 0) return
      fireTimer = FIRE_COOLDOWN
      bullets.push({
        x: ship.x + Math.cos(ship.angle) * SHIP_R,
        y: ship.y + Math.sin(ship.angle) * SHIP_R,
        vx: Math.cos(ship.angle) * BULLET_SPEED + ship.vx,
        vy: Math.sin(ship.angle) * BULLET_SPEED + ship.vy,
        life: BULLET_LIFE,
      })
    }

    function loseLife() {
      lives--
      if (lives <= 0) {
        state = 'over'
        if (score > best) { best = score; localStorage.setItem(BEST_KEY, String(best)) }
        if (auto && !recorded) {
          recorded = true
          recordAutoplayResult('asteroids', score >= 300 || survived >= 20)
        }
      } else {
        resetShip()
      }
    }

    function splitAsteroid(idx) {
      const a = asteroids[idx]
      const s = SIZES[a.size]
      score += s.score
      asteroids.splice(idx, 1)
      if (s.next) {
        asteroids.push(makeAsteroid(a.x, a.y, s.next))
        asteroids.push(makeAsteroid(a.x, a.y, s.next))
      }
    }

    // ---------- autoplay bot ----------
    // Drives the game's own `keys` + fire() each frame (no synthetic key events).
    // Steer the ship smoothly toward a heading: deadzone avoids jitter,
    // and we only turn when the error exceeds it (limited by TURN_SPEED in update).
    const AIM_DEADZONE = 0.08
    function steerTo(targetAngle) {
      let d = targetAngle - ship.angle
      while (d > Math.PI) d -= Math.PI * 2
      while (d < -Math.PI) d += Math.PI * 2
      if (d > AIM_DEADZONE) keys.right = true
      else if (d < -AIM_DEADZONE) keys.left = true
      return d
    }

    function botTick() {
      if (state !== 'playing') return
      keys.left = false; keys.right = false; keys.up = false

      // nearest asteroid (target to shoot)
      let target = null, bestD = Infinity
      for (const a of asteroids) {
        const d = Math.hypot(a.x - ship.x, a.y - ship.y)
        if (d < bestD) { bestD = d; target = a }
      }
      if (!target) return

      if (wantWin) {
        // Survival-first: find the most threatening asteroid (closest, weighted
        // by how soon it reaches us). Avoidance dominates aiming.
        let danger = null, dangerD = Infinity
        for (const a of asteroids) {
          const d = Math.hypot(a.x - ship.x, a.y - ship.y) - a.r
          if (d < dangerD) { dangerD = d; danger = a }
        }
        const DANGER_NEAR = 70    // thrust hard away
        const DANGER_FAR = 130    // start steering away

        if (danger && dangerD < DANGER_FAR) {
          // Point away from the threat and thrust only when roughly aligned,
          // so motion stays controlled instead of accelerating into rocks.
          const away = Math.atan2(ship.y - danger.y, ship.x - danger.x)
          const ad = steerTo(away)
          if (Math.abs(ad) < 0.5 && dangerD < DANGER_NEAR) keys.up = true
        } else {
          // Safe: calmly aim at the nearest rock and fire steadily.
          const desired = Math.atan2(target.y - ship.y, target.x - ship.x)
          const diff = steerTo(desired)
          if (Math.abs(diff) < 0.22) fire()
        }
      } else {
        // sloppy round: aim and fire but never avoid -> gets hit, loses fast.
        const desired = Math.atan2(target.y - ship.y, target.x - ship.x)
        const diff = steerTo(desired)
        if (Math.abs(diff) < 0.30) fire()
      }
    }

    function update(dt) {
      fireTimer = Math.max(0, fireTimer - dt)
      if (auto) botTick()

      if (state === 'ready' || state === 'over') {
        // keep asteroids drifting for ambience
        for (const a of asteroids) {
          a.x += a.vx * dt; a.y += a.vy * dt; a.rot += a.spin * dt; wrap(a)
        }
        return
      }

      // --- ship ---
      if (keys.left) ship.angle -= TURN_SPEED * dt
      if (keys.right) ship.angle += TURN_SPEED * dt
      if (keys.up) {
        ship.vx += Math.cos(ship.angle) * THRUST * dt
        ship.vy += Math.sin(ship.angle) * THRUST * dt
      }
      // friction / inertia
      const decay = Math.exp(-FRICTION * dt)
      ship.vx *= decay; ship.vy *= decay
      const sp = Math.hypot(ship.vx, ship.vy)
      if (sp > MAX_SPEED) { ship.vx = ship.vx / sp * MAX_SPEED; ship.vy = ship.vy / sp * MAX_SPEED }
      // remember pre-move position for swept ship-vs-asteroid collision
      const shipPrevX = ship.x, shipPrevY = ship.y
      ship.x += ship.vx * dt; ship.y += ship.vy * dt
      wrap(ship)
      if (invuln > 0) invuln = Math.max(0, invuln - dt)
      survived += dt

      // --- bullets ---
      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i]
        b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt
        if (b.life <= 0) { bullets.splice(i, 1); continue }
        wrap(b)
      }

      // --- asteroids ---
      for (const a of asteroids) {
        a.x += a.vx * dt; a.y += a.vy * dt; a.rot += a.spin * dt; wrap(a)
      }

      // bullet vs asteroid
      for (let i = asteroids.length - 1; i >= 0; i--) {
        const a = asteroids[i]
        let hit = false
        for (let j = bullets.length - 1; j >= 0; j--) {
          const b = bullets[j]
          if (Math.hypot(b.x - a.x, b.y - a.y) < a.r) {
            bullets.splice(j, 1)
            hit = true
            break
          }
        }
        if (hit) splitAsteroid(i)
      }

      // ship vs asteroid (swept: sample along the ship's per-frame movement so
      // a fast pass can't tunnel through a small asteroid in a single frame)
      if (invuln === 0) {
        const moveX = ship.vx * dt, moveY = ship.vy * dt
        const moveLen = Math.hypot(moveX, moveY)
        // step ~8px along the path; at least 1 sample (the end point)
        const steps = Math.max(1, Math.ceil(moveLen / 8))
        let collided = false
        for (let s = 1; s <= steps && !collided; s++) {
          const t = s / steps
          const sx = shipPrevX + moveX * t
          const sy = shipPrevY + moveY * t
          for (const a of asteroids) {
            if (Math.hypot(sx - a.x, sy - a.y) < a.r + SHIP_R * 0.7) {
              loseLife()
              collided = true
              break
            }
          }
        }
      }

      // next wave
      if (asteroids.length === 0) {
        wave++
        resetShip()
        spawnWave()
      }
    }

    // ---------- input ----------
    function startOrRestart() {
      if (state === 'ready' || state === 'over') newGame()
    }
    function onKeyDown(e) {
      const k = e.code
      if (k === 'ArrowLeft') { keys.left = true; e.preventDefault() }
      else if (k === 'ArrowRight') { keys.right = true; e.preventDefault() }
      else if (k === 'ArrowUp') { keys.up = true; e.preventDefault() }
      else if (k === 'Space') {
        e.preventDefault()
        if (state === 'playing') fire()
        else startOrRestart()
      }
    }
    function onKeyUp(e) {
      const k = e.code
      if (k === 'ArrowLeft') keys.left = false
      else if (k === 'ArrowRight') keys.right = false
      else if (k === 'ArrowUp') keys.up = false
    }
    function onPointer() {
      if (state === 'playing') fire()
      else startOrRestart()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    canvas.addEventListener('pointerdown', onPointer)

    // ---------- drawing ----------
    function sparkle(x, y, s) {
      ctx.strokeStyle = PINK; ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(x - s, y); ctx.lineTo(x + s, y); ctx.moveTo(x, y - s); ctx.lineTo(x, y + s); ctx.stroke()
    }

    function drawShip(x, y, angle, withFlame) {
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(angle)
      ctx.strokeStyle = CYAN
      ctx.lineWidth = 2
      ctx.shadowColor = CYAN; ctx.shadowBlur = 14
      ctx.beginPath()
      ctx.moveTo(SHIP_R, 0)
      ctx.lineTo(-SHIP_R * 0.8, SHIP_R * 0.7)
      ctx.lineTo(-SHIP_R * 0.45, 0)
      ctx.lineTo(-SHIP_R * 0.8, -SHIP_R * 0.7)
      ctx.closePath()
      ctx.stroke()
      if (withFlame && Math.random() > 0.25) {
        const flick = rand(0.6, 1.2)
        ctx.strokeStyle = ORANGE; ctx.shadowColor = ORANGE; ctx.shadowBlur = 16
        ctx.beginPath()
        ctx.moveTo(-SHIP_R * 0.45, SHIP_R * 0.32)
        ctx.lineTo(-SHIP_R * (0.9 + flick), 0)
        ctx.lineTo(-SHIP_R * 0.45, -SHIP_R * 0.32)
        ctx.stroke()
      }
      ctx.shadowBlur = 0
      ctx.restore()
    }

    function drawAsteroid(a) {
      const color = a.size === 'small' ? PINK : '#ffffff'
      ctx.save()
      ctx.translate(a.x, a.y)
      ctx.rotate(a.rot)
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      ctx.shadowColor = color; ctx.shadowBlur = 12
      ctx.beginPath()
      for (let i = 0; i < a.verts; i++) {
        const ang = (i / a.verts) * Math.PI * 2
        const rr = a.r * a.offsets[i]
        const px = Math.cos(ang) * rr
        const py = Math.sin(ang) * rr
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
      }
      ctx.closePath()
      ctx.stroke()
      ctx.shadowBlur = 0
      ctx.restore()
    }

    function label(text, x, y) {
      ctx.fillStyle = PINK
      ctx.font = '700 12px system-ui, sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText(text, x, y)
      const w = ctx.measureText(text).width
      ctx.fillRect(x, y + 5, w, 2)
    }
    function value(text, x, y, color) {
      ctx.fillStyle = color
      ctx.font = '800 22px system-ui, sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText(text, x, y)
    }

    function draw() {
      ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, W, H)
      sparkle(26, 26, 5); sparkle(W - 26, H - 26, 4)

      // asteroids
      for (const a of asteroids) drawAsteroid(a)

      // bullets
      ctx.shadowColor = PINK; ctx.shadowBlur = 12
      ctx.fillStyle = PINK
      for (const b of bullets) {
        ctx.beginPath(); ctx.arc(b.x, b.y, 2.6, 0, Math.PI * 2); ctx.fill()
      }
      ctx.shadowBlur = 0

      // ship (blink during invulnerability)
      if (state === 'playing') {
        const blinkOn = invuln === 0 || Math.floor(invuln * 10) % 2 === 0
        if (blinkOn) drawShip(ship.x, ship.y, ship.angle, keys.up)
      }

      // HUD
      label('SCORE', 20, 52); value(String(score), 20, 80, '#fff')
      label('LIVES', W / 2 - 26, 52)
      // life icons
      ctx.save()
      for (let i = 0; i < lives; i++) {
        const lx = W / 2 - 26 + i * 22
        ctx.translate(lx + 8, 74); ctx.rotate(-Math.PI / 2)
        ctx.strokeStyle = CYAN; ctx.lineWidth = 1.6
        ctx.shadowColor = CYAN; ctx.shadowBlur = 8
        ctx.beginPath()
        ctx.moveTo(8, 0); ctx.lineTo(-6, 5); ctx.lineTo(-3, 0); ctx.lineTo(-6, -5); ctx.closePath()
        ctx.stroke(); ctx.shadowBlur = 0
        ctx.setTransform(1, 0, 0, 1, 0, 0)
      }
      ctx.restore()
      ctx.textAlign = 'right'
      label('BEST', W - 20, 52)
      // re-measure for right align of label underline
      ctx.textAlign = 'left'
      const bestLabelW = ctx.measureText('BEST').width
      ctx.fillStyle = PINK
      ctx.font = '700 12px system-ui, sans-serif'
      ctx.fillText('BEST', W - 20 - bestLabelW, 52)
      ctx.fillRect(W - 20 - bestLabelW, 57, bestLabelW, 2)
      ctx.fillStyle = '#fff'; ctx.font = '800 22px system-ui, sans-serif'
      ctx.textAlign = 'right'
      ctx.fillText(String(best), W - 20, 80)
      ctx.textAlign = 'left'

      // wave indicator
      if (state === 'playing') {
        ctx.fillStyle = '#8a93ad'; ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'center'
        ctx.fillText('WAVE ' + (wave + 1), W / 2, H - 16)
      }

      if (state === 'ready') overlay('ASTEROIDS', 'space / tap to start')
      else if (state === 'over') overlay('GAME OVER', 'space / tap to play again')
    }

    function overlay(title, sub) {
      ctx.fillStyle = 'rgba(10,10,10,0.74)'; ctx.fillRect(0, H / 2 - 90, W, 180)
      ctx.textAlign = 'center'
      ctx.fillStyle = PINK; ctx.font = '800 46px system-ui, sans-serif'
      ctx.shadowColor = PINK; ctx.shadowBlur = 18
      ctx.fillText(title, W / 2, H / 2 - 6)
      ctx.shadowBlur = 0
      ctx.fillStyle = PINK; ctx.fillRect(W / 2 - 80, H / 2 + 14, 160, 4)
      ctx.fillStyle = '#fff'; ctx.font = '600 14px system-ui, sans-serif'
      ctx.fillText(sub, W / 2, H / 2 + 46)
      ctx.fillStyle = '#8a93ad'; ctx.font = '600 11px system-ui, sans-serif'
      ctx.fillText('← → rotate    ↑ thrust    space fire', W / 2, H / 2 + 70)
    }

    function loop(now) {
      let dt = (now - last) / 1000; last = now
      if (dt > 0.05) dt = 0.05
      if (auto) {
        if (state === 'ready') {
          wantWin = shouldAutoWin('asteroids')
          newGame()
        } else if (state === 'over') {
          if (autoRestartAt === 0) autoRestartAt = now + 1300
          else if (now >= autoRestartAt) {
            autoRestartAt = 0
            wantWin = shouldAutoWin('asteroids')
            newGame()
          }
        }
      }
      update(dt)
      draw()
      raf = requestAnimationFrame(loop)
    }

    readyState()
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      canvas.removeEventListener('pointerdown', onPointer)
    }
  }, [])

  return (
    <canvas ref={canvasRef} width={W} height={H} className="asteroids-canvas" aria-label="Asteroids game" />
  )
}
