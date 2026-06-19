import { useEffect, useRef } from 'react'
import { isAutoplay, shouldAutoWin, recordAutoplayResult } from '../autoplay.js'

// Fixed playfield — portrait, like the original.
const W = 400
const H = 600

// Physics (tuned by feel).
const GRAVITY = 0.55
const JUMP_VEL = -15 // upward velocity on each bounce
const MOVE_ACC = 0.9
const MOVE_MAX = 7
const FRICTION = 0.88

// Player.
const P_W = 34
const P_H = 34

// Platforms.
const PLAT_W = 70
const PLAT_H = 14
const GAP_MIN = 60 // vertical spacing between platforms
const GAP_MAX = 95

const BEST_KEY = '10xgames.doodle.best'

export default function DoodleJump() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')

    const auto = isAutoplay('doodle-jump')

    // ---- autoplay bot state ----
    const WIN_SCORE = 1500 // a session counts as a win at this score/height
    let wantWin = true // this round: climb high vs. fall soon (decided per round)
    let restartAt = 0 // timestamp to auto-restart after game over
    let recorded = false // ensure recordAutoplayResult fires once per game over
    let target = null // platform the bot is currently steering toward (target lock)

    // ---- game state ----
    let phase = 'ready' // ready | playing | over
    let px = W / 2 - P_W / 2
    let py = 0
    let vx = 0
    let vy = 0
    let facing = 1 // 1 = right, -1 = left
    let platforms = [] // { x, y, type, vx, broken } type: normal|moving|breakable
    let cameraY = 0 // world->screen offset: screenY = worldY - cameraY
    let maxClimb = 0 // highest (most negative worldY top) reached, drives score
    let score = 0
    let best = Number(localStorage.getItem(BEST_KEY)) || 0
    let left = false
    let right = false
    let topMost = 0 // worldY of the highest generated platform
    let last = performance.now()
    let raf = 0

    // Pick a platform type weighted by current height (harder higher up).
    function pickType() {
      const diff = Math.min(score / 3000, 1) // 0..1 ramp
      const r = Math.random()
      // breakable & moving become more common as diff rises
      const breakP = 0.08 + diff * 0.22
      const moveP = 0.1 + diff * 0.25
      if (r < breakP) return 'breakable'
      if (r < breakP + moveP) return 'moving'
      return 'normal'
    }

    function makePlatform(y, type) {
      const t = type || pickType()
      return {
        x: Math.random() * (W - PLAT_W),
        y,
        type: t,
        vx: t === 'moving' ? (Math.random() < 0.5 ? -1 : 1) * (1.2 + Math.random() * 1.2) : 0,
        broken: false,
      }
    }

    function reset() {
      platforms = []
      cameraY = 0
      maxClimb = 0
      score = 0
      vx = 0
      vy = JUMP_VEL
      facing = 1
      px = W / 2 - P_W / 2
      // Guaranteed solid platform under the player to start.
      let y = H - 60
      platforms.push({ x: W / 2 - PLAT_W / 2, y, type: 'normal', vx: 0, broken: false })
      py = y - P_H
      topMost = y
      // Fill upward beyond the top of the screen.
      while (topMost > cameraY - H) {
        const gap = GAP_MIN + Math.random() * (GAP_MAX - GAP_MIN)
        topMost -= gap
        platforms.push(makePlatform(topMost))
      }
    }

    function start() {
      reset()
      phase = 'playing'
    }

    // Generate more platforms above and cull ones that scrolled off the bottom.
    function manageWorld() {
      // generate above
      while (topMost > cameraY - GAP_MAX) {
        const gap = GAP_MIN + Math.random() * (GAP_MAX - GAP_MIN)
        topMost -= gap
        platforms.push(makePlatform(topMost))
      }
      // remove platforms below the visible bottom
      const cutoff = cameraY + H + 40
      platforms = platforms.filter((p) => p.y < cutoff)
    }

    // wrap-aware signed horizontal distance from a to b (shortest path on the torus)
    function wrapDx(from, to) {
      let dx = to - from
      if (dx > W / 2) dx -= W
      else if (dx < -W / 2) dx += W
      return dx
    }

    // ---- autoplay bot: steer via left/right state, never synthetic keys ----
    function botTick(now) {
      if (!auto) return

      // auto-start from ready; auto-restart ~1.3s after game over
      if (phase === 'ready') {
        wantWin = shouldAutoWin('doodle-jump')
        target = null
        recorded = false
        start()
        return
      }
      if (phase === 'over') {
        if (!recorded) {
          recordAutoplayResult('doodle-jump', score >= WIN_SCORE)
          recorded = true
        }
        if (!restartAt) restartAt = now + 1300
        else if (now >= restartAt) {
          restartAt = 0
          wantWin = shouldAutoWin('doodle-jump')
          target = null
          recorded = false
          start()
        }
        left = false
        right = false
        return
      }

      const pcx = px + P_W / 2

      // Pick the best platform to aim for: the lowest solid platform that is
      // still above the player's feet and horizontally reachable. Climbing one
      // step at a time keeps landings reliable instead of overshooting.
      const feetY = py + P_H
      const drop = vy >= 0 // descending — landing window is now
      // Keep the current target if it's still valid (target lock => no flip-flop).
      if (target) {
        const stillValid =
          !target.broken && platforms.includes(target) && target.y < feetY
        if (!stillValid) target = null
      }
      if (!target) {
        let bestP = null
        let bestScore = Infinity
        for (const p of platforms) {
          if (p.broken) continue
          if (p.y >= feetY) continue // must be above the feet
          const dist = feetY - p.y // how far above (smaller = next step)
          // prefer the nearest step above; tie-break by horizontal closeness
          const hx = Math.abs(wrapDx(pcx, p.x + PLAT_W / 2))
          const s = dist + hx * 0.15
          if (s < bestScore) {
            bestScore = s
            bestP = p
          }
        }
        target = bestP
      }

      if (!target) {
        left = false
        right = false
        return
      }

      // Aim at the platform center. Lead moving platforms slightly toward
      // where they're heading so we don't land at the edge.
      let aimX = target.x + PLAT_W / 2
      if (target.type === 'moving') aimX += target.vx * 8

      if (!wantWin) {
        // sloppy: aim well off the platform so it misses and falls early
        aimX = target.x + (Math.random() < 0.5 ? -140 : PLAT_W + 140)
      }

      const dx = wrapDx(pcx, aimX)

      // Decisive, hysteresis-based steering: commit to a direction and only
      // release inside a wider stop band. This kills left/right flip-flopping.
      const stopBand = wantWin ? 10 : 30
      const goBand = wantWin ? 4 : 24
      if (dx > stopBand) {
        right = true
        left = false
      } else if (dx < -stopBand) {
        left = true
        right = false
      } else if (Math.abs(dx) <= goBand) {
        // close enough and not overshooting fast — coast to a stop
        left = false
        right = false
      }
      // else: within [goBand, stopBand) — hold current input (hysteresis)
    }

    function update(dt) {
      const step = dt / 16.67
      if (phase !== 'playing') return

      // horizontal input
      if (left) vx -= MOVE_ACC * step
      if (right) vx += MOVE_ACC * step
      if (!left && !right) vx *= Math.pow(FRICTION, step)
      vx = Math.max(-MOVE_MAX, Math.min(MOVE_MAX, vx))
      if (vx > 0.1) facing = 1
      else if (vx < -0.1) facing = -1
      px += vx * step

      // horizontal wrap
      if (px + P_W < 0) px = W
      else if (px > W) px = -P_W

      // gravity
      vy += GRAVITY * step
      py += vy * step

      // moving platforms
      for (const p of platforms) {
        if (p.type === 'moving') {
          p.x += p.vx * step
          if (p.x < 0) {
            p.x = 0
            p.vx *= -1
          } else if (p.x + PLAT_W > W) {
            p.x = W - PLAT_W
            p.vx *= -1
          }
        }
      }

      // landing (only when falling)
      if (vy > 0) {
        const feet = py + P_H
        for (const p of platforms) {
          if (p.broken) continue
          if (
            feet >= p.y &&
            feet <= p.y + PLAT_H + vy * step && // don't tunnel through
            px + P_W > p.x &&
            px < p.x + PLAT_W
          ) {
            vy = JUMP_VEL
            if (p.type === 'breakable') p.broken = true
            break
          }
        }
      }

      // camera follows upward progress: keep player around 40% from top
      const targetCam = py - H * 0.4
      if (targetCam < cameraY) cameraY = targetCam

      // score = climb height (positive as you go up)
      maxClimb = Math.min(maxClimb, py)
      score = Math.max(score, Math.floor(-maxClimb / 2))

      manageWorld()

      // game over: fell below bottom of screen
      if (py - cameraY > H) {
        phase = 'over'
        if (score > best) {
          best = score
          localStorage.setItem(BEST_KEY, String(best))
        }
      }
    }

    // ---------- rendering ----------
    function drawPlatform(p) {
      const sy = p.y - cameraY
      if (sy < -PLAT_H || sy > H) return
      ctx.save()
      if (p.type === 'breakable' && p.broken) {
        ctx.globalAlpha = 0.25
      }
      let color
      if (p.type === 'moving') color = '#b14aed'
      else if (p.type === 'breakable') color = '#ff8a1e'
      else color = '#2de2e6'
      ctx.shadowColor = color
      ctx.shadowBlur = 14
      ctx.lineWidth = 2
      ctx.strokeStyle = color
      ctx.fillStyle = color
      const r = 6
      // rounded rect path
      const x = p.x
      const y = sy
      ctx.beginPath()
      ctx.moveTo(x + r, y)
      ctx.arcTo(x + PLAT_W, y, x + PLAT_W, y + PLAT_H, r)
      ctx.arcTo(x + PLAT_W, y + PLAT_H, x, y + PLAT_H, r)
      ctx.arcTo(x, y + PLAT_H, x, y, r)
      ctx.arcTo(x, y, x + PLAT_W, y, r)
      ctx.closePath()
      if (p.type === 'breakable') {
        ctx.setLineDash([6, 5])
        ctx.stroke()
      } else {
        ctx.globalAlpha *= 0.18
        ctx.fill()
        ctx.globalAlpha = p.type === 'breakable' && p.broken ? 0.25 : 1
        ctx.stroke()
      }
      ctx.restore()
    }

    function drawPlayer() {
      const sx = px + P_W / 2
      const sy = py - cameraY + P_H / 2
      ctx.save()
      ctx.shadowColor = '#ff2d6f'
      ctx.shadowBlur = 22
      ctx.fillStyle = '#ff2d6f'
      // glowing blob/ship body
      ctx.beginPath()
      ctx.ellipse(sx, sy, P_W / 2, P_H / 2, 0, 0, Math.PI * 2)
      ctx.fill()
      // bright core
      ctx.shadowBlur = 0
      ctx.fillStyle = 'rgba(255,255,255,0.85)'
      ctx.beginPath()
      ctx.ellipse(sx, sy - 3, P_W / 5, P_H / 5, 0, 0, Math.PI * 2)
      ctx.fill()
      // eye direction nub
      ctx.fillStyle = '#0a0a0a'
      ctx.beginPath()
      ctx.arc(sx + facing * 6, sy - 2, 2.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }

    function drawSparkles() {
      ctx.save()
      ctx.fillStyle = '#ff2d6f'
      ctx.shadowColor = '#ff2d6f'
      ctx.shadowBlur = 8
      ctx.font = 'bold 16px system-ui, sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText('+', 10, 24)
      ctx.textAlign = 'right'
      ctx.fillText('+', W - 10, 24)
      ctx.textAlign = 'left'
      ctx.fillText('+', 10, H - 12)
      ctx.textAlign = 'right'
      ctx.fillText('+', W - 10, H - 12)
      ctx.restore()
    }

    function drawHUD() {
      ctx.save()
      ctx.textAlign = 'left'
      // SCORE label
      ctx.fillStyle = '#ff2d6f'
      ctx.font = 'bold 13px system-ui, sans-serif'
      ctx.fillText('SCORE', 22, 36)
      // pink underline bar
      ctx.fillStyle = '#ff2d6f'
      ctx.fillRect(22, 42, 46, 3)
      // value
      ctx.fillStyle = '#ffffff'
      ctx.font = 'bold 26px system-ui, sans-serif'
      ctx.fillText(String(score), 22, 72)

      // BEST (right aligned)
      ctx.textAlign = 'right'
      ctx.fillStyle = '#8a93ad'
      ctx.font = 'bold 13px system-ui, sans-serif'
      ctx.fillText('BEST', W - 22, 36)
      ctx.fillStyle = '#ffffff'
      ctx.font = 'bold 22px system-ui, sans-serif'
      ctx.fillText(String(best), W - 22, 64)
      ctx.restore()
    }

    function drawCenterText(title, sub) {
      ctx.save()
      ctx.textAlign = 'center'
      ctx.fillStyle = '#ff2d6f'
      ctx.shadowColor = '#ff2d6f'
      ctx.shadowBlur = 18
      ctx.font = 'bold 34px system-ui, sans-serif'
      ctx.fillText(title, W / 2, H / 2 - 10)
      ctx.shadowBlur = 0
      ctx.fillStyle = '#8a93ad'
      ctx.font = '15px system-ui, sans-serif'
      ctx.fillText(sub, W / 2, H / 2 + 26)
      ctx.restore()
    }

    function draw() {
      ctx.fillStyle = '#0a0a0a'
      ctx.fillRect(0, 0, W, H)

      for (const p of platforms) drawPlatform(p)
      if (phase !== 'ready') drawPlayer()

      drawSparkles()
      drawHUD()

      if (phase === 'ready') {
        drawCenterText('DOODLE JUMP', 'press SPACE / tap to start')
      } else if (phase === 'over') {
        drawCenterText('GAME OVER', 'press SPACE / tap to restart')
      }
    }

    function loop(now) {
      let dt = now - last
      last = now
      if (dt > 50) dt = 50
      botTick(now)
      update(dt)
      draw()
      raf = requestAnimationFrame(loop)
    }

    // ---- input ----
    function activate() {
      if (phase === 'ready' || phase === 'over') start()
    }

    const onKey = (e) => {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        e.preventDefault()
        left = true
      } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        e.preventDefault()
        right = true
      } else if (e.code === 'Space') {
        e.preventDefault()
        activate()
      }
    }
    const onKeyUp = (e) => {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') left = false
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') right = false
    }
    const onPointer = (e) => {
      e.preventDefault()
      if (phase === 'ready' || phase === 'over') {
        activate()
        return
      }
      // tap left/right half to steer while playing
      const rect = canvas.getBoundingClientRect()
      const x = (e.clientX - rect.left) / rect.width
      if (x < 0.5) {
        left = true
        right = false
      } else {
        right = true
        left = false
      }
    }
    const onPointerUp = () => {
      left = false
      right = false
    }

    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    canvas.addEventListener('pointerdown', onPointer)
    window.addEventListener('pointerup', onPointerUp)

    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
      canvas.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('pointerup', onPointerUp)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      className="doodle-canvas"
      aria-label="Doodle Jump game"
    />
  )
}
