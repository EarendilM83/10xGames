import { useEffect, useRef } from 'react'
import { isAutoplay, shouldAutoWin, recordAutoplayResult } from '../autoplay.js'

// Fixed portrait playfield.
const W = 420
const H = 600

// Open-topped container (drop zone above it).
const PAD_X = 30 // wall thickness / inset from canvas edge
const TOP = 130 // top line of the container (the "overflow" line)
const FLOOR = H - 24 // inner floor y
const LEFT = PAD_X // inner left wall x
const RIGHT = W - PAD_X // inner right wall x

// Physics tuning (sub-stepped, capped, clamped — can't explode or NaN).
const GRAVITY = 0.42
const REST = 0.12 // restitution (bounciness) — low so things settle
const WALL_REST = 0.2
const FRICTION = 0.92 // tangential damping on contact
const AIR = 0.999 // mild air drag
const MAX_V = 18 // hard velocity clamp (prevents tunneling/explosions)
const CORRECT = 0.8 // positional-correction fraction per iteration
const SLOP = 0.5 // penetration allowance
const SOLVER_ITERS = 6 // collision solver passes per sub-step
const SUBSTEPS = 2 // fixed physics sub-steps per frame

// Fruit tiers: glossy neon colors, radius grows per tier.
const TIERS = [
  { r: 14, color: '#ff2d6f' }, // 0 pink
  { r: 19, color: '#2de2e6' }, // 1 cyan
  { r: 25, color: '#b14aed' }, // 2 purple
  { r: 31, color: '#54e346' }, // 3 green
  { r: 38, color: '#ffd60a' }, // 4 yellow
  { r: 46, color: '#ff8a1e' }, // 5 orange
  { r: 55, color: '#4d7cff' }, // 6 blue
  { r: 65, color: '#ff5edb' }, // 7 magenta
  { r: 76, color: '#1ee6a8' }, // 8 mint
  { r: 88, color: '#9bff3c' }, // 9 watermelon (lime)
]
const MAX_TIER = TIERS.length - 1

// Only the smaller tiers can be dropped (keeps the game playable like Suika).
const DROP_TIERS = 5

const BEST_KEY = '10xgames.suika.best'

export default function Suika() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')

    const auto = isAutoplay('suika')

    // ---- autoplay bot state ----
    const WIN_SCORE = 600 // session is a "win" at this score before overflow
    let wantWin = true
    let restartAt = 0
    let recorded = false
    let nextDropAt = 0 // timestamp when bot may drop again (wait for settle)

    // ---- game state ----
    let phase = 'playing' // playing | over
    let balls = [] // { x, y, vx, vy, tier, r, merged }
    let dropX = W / 2
    let current = randDropTier() // tier waiting to drop
    let next = randDropTier() // preview
    let canDrop = true // false during a brief cooldown after a drop
    let dropCooldown = 0
    let score = 0
    let best = Number(localStorage.getItem(BEST_KEY)) || 0
    let overflowTimer = 0 // ms a fruit has been above the top line
    let last = performance.now()
    let raf = 0

    function randDropTier() {
      return Math.floor(Math.random() * DROP_TIERS)
    }

    function reset() {
      balls = []
      score = 0
      overflowTimer = 0
      current = randDropTier()
      next = randDropTier()
      canDrop = true
      dropCooldown = 0
      dropX = W / 2
      phase = 'playing'
    }

    function clampNum(v) {
      // Guard against NaN/Infinity ever entering a position/velocity.
      return Number.isFinite(v) ? v : 0
    }

    function spawnDrop() {
      if (!canDrop || phase !== 'playing') return
      const r = TIERS[current].r
      const x = Math.max(LEFT + r, Math.min(RIGHT - r, dropX))
      balls.push({ x, y: TOP - 20, vx: 0, vy: 0, tier: current, r, merged: false })
      current = next
      next = randDropTier()
      canDrop = false
      dropCooldown = 320 // ms before next drop allowed
    }

    // ---- physics sub-step ----
    function physicsStep() {
      // integrate
      for (const b of balls) {
        b.vy += GRAVITY
        b.vx *= AIR
        b.vy *= AIR
        // clamp velocity to avoid explosions / tunneling
        if (b.vx > MAX_V) b.vx = MAX_V
        else if (b.vx < -MAX_V) b.vx = -MAX_V
        if (b.vy > MAX_V) b.vy = MAX_V
        else if (b.vy < -MAX_V) b.vy = -MAX_V
        b.x = clampNum(b.x + b.vx)
        b.y = clampNum(b.y + b.vy)
      }

      // walls + floor
      for (const b of balls) {
        if (b.x - b.r < LEFT) {
          b.x = LEFT + b.r
          if (b.vx < 0) b.vx = -b.vx * WALL_REST
        } else if (b.x + b.r > RIGHT) {
          b.x = RIGHT - b.r
          if (b.vx > 0) b.vx = -b.vx * WALL_REST
        }
        if (b.y + b.r > FLOOR) {
          b.y = FLOOR - b.r
          if (b.vy > 0) b.vy = -b.vy * REST
          b.vx *= FRICTION
        }
      }

      // circle-circle collisions (a few iterations to settle)
      for (let it = 0; it < SOLVER_ITERS; it++) {
        for (let i = 0; i < balls.length; i++) {
          const a = balls[i]
          for (let j = i + 1; j < balls.length; j++) {
            const c = balls[j]
            let dx = c.x - a.x
            let dy = c.y - a.y
            let dist2 = dx * dx + dy * dy
            const minD = a.r + c.r
            if (dist2 >= minD * minD) continue
            let dist = Math.sqrt(dist2)
            if (dist < 1e-6) {
              // perfectly overlapping — nudge apart deterministically
              dx = 0.01
              dy = 0.01
              dist = 0.0141
            }
            const nx = dx / dist
            const ny = dy / dist
            const pen = minD - dist

            // merge same tier on contact (skip already-merged this frame)
            if (a.tier === c.tier && !a.merged && !c.merged && a.tier < MAX_TIER) {
              mergePair(a, c)
              // a and c flagged merged; break out of inner loop for a
              if (a.merged) break
              continue
            }

            // positional correction (mass ~ area, split by radius^2)
            const corr = (Math.max(pen - SLOP, 0) / 2) * CORRECT
            a.x = clampNum(a.x - nx * corr)
            a.y = clampNum(a.y - ny * corr)
            c.x = clampNum(c.x + nx * corr)
            c.y = clampNum(c.y + ny * corr)

            // velocity response along the normal
            const rvx = c.vx - a.vx
            const rvy = c.vy - a.vy
            const vn = rvx * nx + rvy * ny
            if (vn < 0) {
              const imp = -(1 + REST) * vn * 0.5
              a.vx = clampNum(a.vx - nx * imp)
              a.vy = clampNum(a.vy - ny * imp)
              c.vx = clampNum(c.vx + nx * imp)
              c.vy = clampNum(c.vy + ny * imp)
            }
          }
        }
      }

      // remove merged ones
      if (balls.some((b) => b.merged)) balls = balls.filter((b) => !b.merged)
    }

    function mergePair(a, c) {
      a.merged = true
      c.merged = true
      const nt = a.tier + 1
      const r = TIERS[nt].r
      const mx = (a.x + c.x) / 2
      const my = (a.y + c.y) / 2
      balls.push({
        x: mx,
        y: my,
        vx: (a.vx + c.vx) / 2,
        vy: (a.vy + c.vy) / 2,
        tier: nt,
        r,
        merged: false,
      })
      // bigger merges score more (tier+1 squared-ish growth)
      score += (nt + 1) * 2
    }

    // ---- overflow / game over check ----
    function checkOverflow(dtMs) {
      // a fruit counts as overflowing only when it is (roughly) at rest above
      // the top line — falling fruit passing through the line is fine.
      let over = false
      for (const b of balls) {
        if (b.y - b.r < TOP && Math.abs(b.vy) < 0.6) {
          over = true
          break
        }
      }
      if (over) {
        overflowTimer += dtMs
        if (overflowTimer > 900) {
          phase = 'over'
          if (score > best) {
            best = score
            localStorage.setItem(BEST_KEY, String(best))
          }
        }
      } else {
        overflowTimer = Math.max(0, overflowTimer - dtMs * 1.5)
      }
    }

    // ---- autoplay bot ----
    function botTick(now) {
      if (!auto) return

      if (phase === 'over') {
        if (!recorded) {
          recordAutoplayResult('suika', score >= WIN_SCORE)
          recorded = true
        }
        if (!restartAt) restartAt = now + 1400
        else if (now >= restartAt) {
          restartAt = 0
          recorded = false
          wantWin = shouldAutoWin('suika')
          reset()
          nextDropAt = now + 400
        }
        return
      }

      if (now < nextDropAt) return
      if (!canDrop) return

      // choose drop x
      if (!wantWin) {
        // lose round: drop at random extremes so the stack overflows fast
        dropX = LEFT + Math.random() * (RIGHT - LEFT)
      } else {
        dropX = chooseDropX()
      }
      spawnDrop()
      nextDropAt = now + 620 // wait for the previous to settle before next drop
    }

    // Heuristic: drop near an existing same-tier fruit to merge; otherwise keep
    // small fruit on the sides and big fruit toward the middle.
    function chooseDropX() {
      const r = TIERS[current].r
      const minX = LEFT + r
      const maxX = RIGHT - r

      // 1) find the highest (lowest stack pressure) same-tier fruit to land on
      let best = null
      let bestY = -Infinity
      for (const b of balls) {
        if (b.tier !== current) continue
        // prefer one whose top is reachable and that isn't buried
        if (b.y > bestY) {
          bestY = b.y
          best = b
        }
      }
      if (best) {
        return Math.max(minX, Math.min(maxX, best.x))
      }

      // 2) no match: place small tiers near the walls, big tiers central.
      // also avoid stacking right where the tallest column already is.
      let target
      if (current <= 1) {
        target = Math.random() < 0.5 ? minX + 8 : maxX - 8
      } else if (current >= 3) {
        target = (LEFT + RIGHT) / 2
      } else {
        // mid tiers: pick the emptiest third of the container
        target = emptiestX(r)
      }
      return Math.max(minX, Math.min(maxX, target))
    }

    // Find an x with the lowest local stack height (most open space below TOP).
    function emptiestX(r) {
      const cols = 5
      const colW = (RIGHT - LEFT) / cols
      const heights = new Array(cols).fill(FLOOR)
      for (const b of balls) {
        const ci = Math.max(0, Math.min(cols - 1, Math.floor((b.x - LEFT) / colW)))
        if (b.y - b.r < heights[ci]) heights[ci] = b.y - b.r
      }
      // highest 'heights' value (closest to FLOOR) = emptiest column
      let bestCol = 0
      for (let i = 1; i < cols; i++) if (heights[i] > heights[bestCol]) bestCol = i
      return LEFT + colW * (bestCol + 0.5)
    }

    // ---- update ----
    function update(dtMs) {
      if (phase !== 'playing') return

      // drop cooldown
      if (!canDrop) {
        dropCooldown -= dtMs
        if (dropCooldown <= 0) {
          dropCooldown = 0
          canDrop = true
        }
      }

      // fixed sub-steps for stable physics
      for (let s = 0; s < SUBSTEPS; s++) physicsStep()

      checkOverflow(dtMs)
    }

    // ---------- rendering ----------
    function drawBall(b) {
      const t = TIERS[b.tier]
      ctx.save()
      // glow
      ctx.shadowColor = t.color
      ctx.shadowBlur = 16
      ctx.beginPath()
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2)
      ctx.fillStyle = t.color
      ctx.globalAlpha = 0.22
      ctx.fill()
      // solid ring
      ctx.globalAlpha = 1
      ctx.lineWidth = 2
      ctx.strokeStyle = t.color
      ctx.stroke()
      ctx.shadowBlur = 0
      // glossy inner body
      ctx.globalAlpha = 0.5
      ctx.beginPath()
      ctx.arc(b.x, b.y, Math.max(1, b.r - 3), 0, Math.PI * 2)
      ctx.fillStyle = t.color
      ctx.fill()
      // white highlight
      ctx.globalAlpha = 0.85
      ctx.beginPath()
      ctx.arc(b.x - b.r * 0.32, b.y - b.r * 0.34, Math.max(1.5, b.r * 0.22), 0, Math.PI * 2)
      ctx.fillStyle = '#ffffff'
      ctx.fill()
      ctx.restore()
    }

    function drawContainer() {
      ctx.save()
      ctx.strokeStyle = '#ff2d6f'
      ctx.shadowColor = '#ff2d6f'
      ctx.shadowBlur = 14
      ctx.lineWidth = 4
      ctx.lineCap = 'round'
      // left wall, floor, right wall (open top)
      ctx.beginPath()
      ctx.moveTo(LEFT, TOP)
      ctx.lineTo(LEFT, FLOOR)
      ctx.lineTo(RIGHT, FLOOR)
      ctx.lineTo(RIGHT, TOP)
      ctx.stroke()
      ctx.restore()
    }

    function drawTopLine() {
      ctx.save()
      // dotted overflow line (top of container), tinted red when near overflow
      const danger = overflowTimer > 200
      ctx.strokeStyle = danger ? '#ff2d6f' : 'rgba(255,45,111,0.4)'
      ctx.lineWidth = 1.5
      ctx.setLineDash([6, 6])
      ctx.beginPath()
      ctx.moveTo(LEFT, TOP)
      ctx.lineTo(RIGHT, TOP)
      ctx.stroke()
      ctx.restore()
    }

    function drawGuide() {
      if (phase !== 'playing' || !canDrop) return
      const r = TIERS[current].r
      const x = Math.max(LEFT + r, Math.min(RIGHT - r, dropX))
      ctx.save()
      // dotted vertical guide
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'
      ctx.lineWidth = 1.5
      ctx.setLineDash([5, 7])
      ctx.beginPath()
      ctx.moveTo(x, TOP)
      ctx.lineTo(x, FLOOR)
      ctx.stroke()
      ctx.setLineDash([])
      // the fruit waiting to drop, above the container
      drawBall({ x, y: TOP - 30, r, tier: current })
      ctx.restore()
    }

    function drawSparkles() {
      ctx.save()
      ctx.fillStyle = '#ff2d6f'
      ctx.shadowColor = '#ff2d6f'
      ctx.shadowBlur = 8
      ctx.font = 'bold 16px system-ui, sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText('+', 10, 22)
      ctx.textAlign = 'right'
      ctx.fillText('+', W - 10, 22)
      ctx.textAlign = 'left'
      ctx.fillText('+', 10, H - 10)
      ctx.textAlign = 'right'
      ctx.fillText('+', W - 10, H - 10)
      ctx.restore()
    }

    function drawHUD() {
      ctx.save()
      ctx.textAlign = 'left'
      // SCORE
      ctx.fillStyle = '#ff2d6f'
      ctx.font = 'bold 13px system-ui, sans-serif'
      ctx.fillText('SCORE', 22, 34)
      ctx.fillRect(22, 40, 46, 3)
      ctx.fillStyle = '#ffffff'
      ctx.font = 'bold 26px system-ui, sans-serif'
      ctx.fillText(String(score), 22, 70)

      // BEST (center)
      ctx.textAlign = 'center'
      ctx.fillStyle = '#ff2d6f'
      ctx.font = 'bold 13px system-ui, sans-serif'
      ctx.fillText('BEST', W / 2, 34)
      ctx.fillRect(W / 2 - 23, 40, 46, 3)
      ctx.fillStyle = '#ffffff'
      ctx.font = 'bold 22px system-ui, sans-serif'
      ctx.fillText(String(best), W / 2, 66)

      // NEXT (right) with a mini preview swatch
      ctx.textAlign = 'right'
      ctx.fillStyle = '#ff2d6f'
      ctx.font = 'bold 13px system-ui, sans-serif'
      ctx.fillText('NEXT', W - 22, 34)
      ctx.fillRect(W - 68, 40, 46, 3)
      const nt = TIERS[next]
      ctx.shadowColor = nt.color
      ctx.shadowBlur = 12
      ctx.beginPath()
      ctx.arc(W - 36, 60, 12, 0, Math.PI * 2)
      ctx.fillStyle = nt.color
      ctx.fill()
      ctx.shadowBlur = 0
      ctx.beginPath()
      ctx.arc(W - 40, 56, 3, 0, Math.PI * 2)
      ctx.fillStyle = '#ffffff'
      ctx.fill()
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

      drawContainer()
      drawTopLine()
      for (const b of balls) drawBall(b)
      drawGuide()
      drawSparkles()
      drawHUD()

      if (phase === 'over') {
        drawCenterText('GAME OVER', auto ? 'restarting…' : 'press SPACE / tap to restart')
      }
    }

    function loop(now) {
      let dt = now - last
      last = now
      if (dt > 50) dt = 50 // cap delta so a stall can't blow up physics
      botTick(now)
      update(dt)
      draw()
      raf = requestAnimationFrame(loop)
    }

    // ---- input ----
    function setAimFromClientX(clientX) {
      const rect = canvas.getBoundingClientRect()
      const x = ((clientX - rect.left) / rect.width) * W
      dropX = Math.max(LEFT, Math.min(RIGHT, x))
    }

    const onPointerMove = (e) => {
      if (auto) return
      setAimFromClientX(e.clientX)
    }
    const onPointerDown = (e) => {
      e.preventDefault()
      if (auto) return
      if (phase === 'over') {
        reset()
        return
      }
      setAimFromClientX(e.clientX)
      spawnDrop()
    }
    const onKey = (e) => {
      if (auto) return
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        e.preventDefault()
        dropX = Math.max(LEFT, dropX - 16)
      } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        e.preventDefault()
        dropX = Math.min(RIGHT, dropX + 16)
      } else if (e.code === 'Space') {
        e.preventDefault()
        if (phase === 'over') reset()
        else spawnDrop()
      }
    }

    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKey)

    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      className="suika-canvas"
      aria-label="Suika merge game"
    />
  )
}
