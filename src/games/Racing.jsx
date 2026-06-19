import { useEffect, useRef } from 'react'
import { isAutoplay, shouldAutoWin, recordAutoplayResult } from '../autoplay.js'

// Top-down arcade racing on canvas, 10x neon style.
// A closed rounded-rectangle circuit. Player car has arcade physics: accelerate,
// brake/reverse, speed-dependent steering. Off-road = grass slows you.
// Checkpoints must be hit IN ORDER (no cutting); the start/finish line completes a lap.
// Race is best of 3 laps; rival AI cars follow the racing line. Win = finish first.
const W = 640
const H = 560
const LAPS = 3

const BG = '#0a0a0a'
const PINK = '#ff2d6f'
const ROAD = '#1c1c22'
const GRASS_FRICTION = 0.965    // per-frame velocity decay on grass
const ROAD_FRICTION = 0.992
const ACCEL = 230               // px/s^2 (forward)
const BRAKE = 300
const MAX_SPEED = 250
const TURN_RATE = 2.6           // rad/s at low speed
const BEST_KEY = '10xgames.racing.best'

const RIVAL_COLORS = ['#2de2e6', '#a06bff', '#ff8a1e']

// Center of the track and the half-width/half-height of the rounded-rect racing line.
const CX = W / 2
const CY = H / 2
const RX = 230   // horizontal radius of the oval racing line
const RY = 175   // vertical radius
const ROAD_HALF = 52   // half road width

// Build the racing line as a closed list of waypoints around an oval.
function buildWaypoints(n) {
  const pts = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2 // start at top
    pts.push({ x: CX + Math.cos(a) * RX, y: CY + Math.sin(a) * RY })
  }
  return pts
}

export default function Racing() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const auto = isAutoplay('racing')
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')

    const WP = buildWaypoints(48)
    const NWP = WP.length

    // Checkpoints: a subset of waypoints spread around the loop. Index 0 is the
    // start/finish line. Must be crossed in order; crossing CP 0 again = lap done.
    const CP_COUNT = 8
    const checkpoints = []
    for (let i = 0; i < CP_COUNT; i++) {
      const wpIndex = Math.round((i / CP_COUNT) * NWP) % NWP
      checkpoints.push({ ...WP[wpIndex], wpIndex })
    }

    // ----- state -----
    let state = 'ready' // 'ready' | 'countdown' | 'racing' | 'finished'
    let raf = 0
    let last = performance.now()
    let countdown = 0      // seconds remaining in countdown
    let raceTime = 0       // total elapsed since green
    let resultText = ''

    let best = Infinity
    try {
      const v = parseFloat(localStorage.getItem(BEST_KEY) || '')
      if (isFinite(v) && v > 0) best = v
    } catch { best = Infinity }

    // autoplay round control
    let autoWantWin = true
    let autoNextAt = 0
    let autoRecorded = false
    let autoTimer = 0

    // ----- cars -----
    // Each car: pos, heading angle, speed, lap progress (nextCp), lap count, lapStart, bestLap.
    function makeCar(color, offset, isPlayer) {
      return {
        x: WP[0].x, y: WP[0].y,
        angle: Math.atan2(WP[1].y - WP[0].y, WP[1].x - WP[0].x),
        speed: 0,
        color,
        isPlayer,
        nextCp: 1,        // next checkpoint index expected (0 already at line)
        lap: 0,
        lapStart: 0,
        lastLap: 0,
        bestLap: Infinity,
        finished: false,
        finishOrder: 0,
        targetWp: 1,      // AI / autoplay aim
        laneOffset: offset, // perpendicular offset from racing line (px)
        skill: 1,         // 0..1 driving competence (autoplay tuning)
      }
    }

    let player
    let rivals = []
    let finishCounter = 0

    function resetRace() {
      autoRecorded = false
      raceTime = 0
      resultText = ''
      finishCounter = 0

      if (auto) autoWantWin = shouldAutoWin('racing')

      player = makeCar(PINK, 0, true)
      rivals = [
        makeCar(RIVAL_COLORS[0], -22, false),
        makeCar(RIVAL_COLORS[1], 14, false),
        makeCar(RIVAL_COLORS[2], 26, false),
      ]
      // Stagger the starting grid slightly behind the line so nobody overlaps.
      const grid = [player, ...rivals]
      grid.forEach((c, i) => {
        const back = WP[NWP - 1 - i]
        c.x = back.x + (i % 2 === 0 ? -10 : 10)
        c.y = back.y
        c.angle = Math.atan2(WP[0].y - back.y, WP[0].x - back.x)
      })

      // Rival skill / speed scaling depends on whether the player should win.
      if (auto) {
        if (autoWantWin) {
          player.skill = 1
          rivals.forEach(r => { r.skill = 0.78 + Math.random() * 0.05 })
        } else {
          player.skill = 0.62   // sloppy player
          rivals.forEach(r => { r.skill = 0.95 + Math.random() * 0.05 })
        }
      } else {
        rivals.forEach(r => { r.skill = 0.85 + Math.random() * 0.08 })
      }
    }

    // ----- input -----
    const keys = Object.create(null)
    function onKeyDown(e) {
      const k = e.key.toLowerCase()
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k) || e.key === ' ') {
        e.preventDefault()
      }
      keys[k] = true
      if (k === ' ') startOrRestart()
    }
    function onKeyUp(e) { keys[e.key.toLowerCase()] = false }
    function onPointer(e) { e.preventDefault(); startOrRestart() }

    function startOrRestart() {
      if (state === 'ready' || state === 'finished') {
        resetRace()
        state = 'countdown'
        countdown = 3
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    canvas.addEventListener('pointerdown', onPointer)

    // ----- geometry helpers -----
    // Distance from a point to the racing-line oval, used to detect off-road.
    // Approx: normalize into unit circle space, measure radial distance, scale back.
    function distToRoadCenter(x, y) {
      // Find nearest waypoint quickly, then refine with neighbors.
      let bestD = Infinity, bestI = 0
      for (let i = 0; i < NWP; i++) {
        const dx = x - WP[i].x, dy = y - WP[i].y
        const d = dx * dx + dy * dy
        if (d < bestD) { bestD = d; bestI = i }
      }
      return { dist: Math.sqrt(bestD), wpIndex: bestI }
    }

    // ----- AI / autoplay driving: steer toward an upcoming waypoint -----
    function driveTowardLine(c, dt, throttleScale, ahead) {
      // Find nearest waypoint to the car, aim a few ahead for smoothness.
      const near = distToRoadCenter(c.x, c.y).wpIndex
      let aimIdx = (near + ahead) % NWP
      // apply lane offset perpendicular to track direction
      const nextIdx = (aimIdx + 1) % NWP
      const tx0 = WP[aimIdx].x, ty0 = WP[aimIdx].y
      const dirx = WP[nextIdx].x - tx0, diry = WP[nextIdx].y - ty0
      const dl = Math.hypot(dirx, diry) || 1
      const px = -diry / dl, py = dirx / dl
      const aimX = tx0 + px * c.laneOffset
      const aimY = ty0 + py * c.laneOffset

      const desired = Math.atan2(aimY - c.y, aimX - c.x)
      let diff = desired - c.angle
      while (diff > Math.PI) diff -= Math.PI * 2
      while (diff < -Math.PI) diff += Math.PI * 2

      // Steer; turn rate eases with speed (arcade feel).
      const steer = Math.max(-1, Math.min(1, diff * 2.2))
      const turn = TURN_RATE * (0.5 + 0.5 * (1 - Math.min(c.speed, MAX_SPEED) / MAX_SPEED))
      c.angle += steer * turn * dt

      // Ease throttle in sharp corners (big heading diff = slow down).
      const corner = Math.min(1, Math.abs(diff) / 0.9)
      const target = MAX_SPEED * throttleScale * (1 - corner * 0.45)
      if (c.speed < target) c.speed += ACCEL * dt
      else c.speed -= BRAKE * 0.5 * dt
    }

    function driveHumanPlayer(c, dt) {
      const up = keys['arrowup'] || keys['w']
      const down = keys['arrowdown'] || keys['s']
      const left = keys['arrowleft'] || keys['a']
      const right = keys['arrowright'] || keys['d']

      if (up) c.speed += ACCEL * dt
      if (down) c.speed -= BRAKE * dt
      // speed-dependent steering: more responsive at moderate speed, less when near-stopped
      const speedFactor = Math.min(1, Math.abs(c.speed) / 60)
      const dir = c.speed >= 0 ? 1 : -1
      if (left) c.angle -= TURN_RATE * speedFactor * dir * dt
      if (right) c.angle += TURN_RATE * speedFactor * dir * dt
    }

    function updateCar(c, dt) {
      if (c.finished) { c.speed *= 0.9; return }

      if (c.isPlayer && !auto) {
        driveHumanPlayer(c, dt)
      } else if (c.isPlayer && auto) {
        // autoplay player drives the line; wobble/throttle vary with skill
        const ahead = 3
        const throttle = 0.92 * c.skill + (autoWantWin ? 0.08 : 0)
        driveTowardLine(c, dt, Math.min(1, throttle), ahead)
        if (c.skill < 0.7) {
          // sloppy: occasional drift off the line
          c.angle += Math.sin(raceTime * 5) * 0.04
        }
      } else {
        // rival AI
        const throttle = 0.9 * c.skill
        driveTowardLine(c, dt, throttle, 3)
        // slight avoidance of player
        if (player) {
          const dx = c.x - player.x, dy = c.y - player.y
          const d = Math.hypot(dx, dy)
          if (d < 34 && d > 0.01) {
            c.angle += (Math.atan2(dy, dx) - c.angle) * 0.02
          }
        }
      }

      // clamp speed
      c.speed = Math.max(-MAX_SPEED * 0.4, Math.min(MAX_SPEED, c.speed))

      // friction: grass vs road
      const { dist } = distToRoadCenter(c.x, c.y)
      const onRoad = dist < ROAD_HALF
      c.speed *= onRoad ? ROAD_FRICTION : GRASS_FRICTION
      if (!onRoad) c.speed *= 0.985 // extra drag on grass

      // integrate
      c.x += Math.cos(c.angle) * c.speed * dt
      c.y += Math.sin(c.angle) * c.speed * dt

      // checkpoint / lap progress (must hit in order)
      checkProgress(c)
    }

    function checkProgress(c) {
      const cp = checkpoints[c.nextCp]
      const dx = c.x - cp.x, dy = c.y - cp.y
      if (dx * dx + dy * dy < (ROAD_HALF + 14) * (ROAD_HALF + 14)) {
        if (c.nextCp === 0) {
          // crossing the start/finish line in order = lap complete
          const now = raceTime
          const lapTime = now - c.lapStart
          c.lapStart = now
          if (c.lap > 0) { // first crossing is the actual start of lap 1 timing
            c.lastLap = lapTime
            if (lapTime < c.bestLap) c.bestLap = lapTime
            if (c.isPlayer && lapTime < best) { best = lapTime; saveBest() }
          }
          c.lap += 1
          if (c.lap > LAPS) {
            c.finished = true
            c.lap = LAPS
            finishCounter += 1
            c.finishOrder = finishCounter
          }
          c.nextCp = 1
        } else {
          c.nextCp = (c.nextCp + 1) % CP_COUNT
        }
      }
    }

    function saveBest() {
      try { localStorage.setItem(BEST_KEY, String(best)) } catch { /* ignore */ }
    }

    // current placing (1-based) of the player vs rivals by total progress.
    function progressValue(c) {
      // laps dominate, then checkpoint index, then distance into the segment toward next cp
      const cp = checkpoints[c.nextCp]
      const d = Math.hypot(c.x - cp.x, c.y - cp.y)
      return c.lap * 10000 + c.nextCp * 1000 - d
    }
    function playerPlace() {
      const all = [player, ...rivals]
      // finished cars rank by finishOrder; unfinished by progress
      all.sort((a, b) => {
        if (a.finished && b.finished) return a.finishOrder - b.finishOrder
        if (a.finished) return -1
        if (b.finished) return 1
        return progressValue(b) - progressValue(a)
      })
      return all.indexOf(player) + 1
    }

    // ----- main loop -----
    function frame(now) {
      let dt = (now - last) / 1000
      last = now
      if (dt > 0.05) dt = 0.05 // clamp delta

      if (state === 'countdown') {
        countdown -= dt
        if (countdown <= 0) {
          state = 'racing'
          // set lapStart baseline; lap counts begin at 0 -> first line crossing makes lap 1
          const all = [player, ...rivals]
          all.forEach(c => { c.lapStart = 0 })
        }
      } else if (state === 'racing') {
        raceTime += dt
        updateCar(player, dt)
        rivals.forEach(r => updateCar(r, dt))

        if (player.finished || rivals.every(r => r.finished)) {
          // finish when player done, or all rivals done (player loses by DNF cutoff)
          if (player.finished) {
            state = 'finished'
            const won = player.finishOrder === 1
            resultText = won ? 'YOU WIN' : `P${player.finishOrder} FINISH`
            if (auto && !autoRecorded) {
              autoRecorded = true
              recordAutoplayResult('racing', won)
              clearTimeout(autoTimer)
              autoTimer = setTimeout(startOrRestart, 2200) // restart via timer (reliable)
            }
          }
        }
      }

      render()
      raf = requestAnimationFrame(frame)
    }

    // ----- rendering -----
    function render() {
      ctx.fillStyle = BG
      ctx.fillRect(0, 0, W, H)

      drawTrack()
      drawStartLine()
      drawCheckpoints()

      if (player) {
        rivals.forEach(drawCar)
        drawCar(player)
      }

      drawHUD()
      drawSparkles()

      if (state === 'ready') {
        drawCenter('RACING', 'SPACE / TAP TO START', '3 LAPS · BEAT THE PACK')
      } else if (state === 'countdown') {
        const n = Math.ceil(countdown)
        drawCenter(n > 0 ? String(n) : 'GO', '', '')
      } else if (state === 'finished') {
        drawCenter(resultText, auto ? '' : 'SPACE / TAP TO RACE AGAIN', '')
      }
    }

    function drawTrack() {
      // Draw road as a thick stroked oval (outer/inner via lineWidth).
      ctx.save()
      ctx.strokeStyle = ROAD
      ctx.lineWidth = ROAD_HALF * 2
      ctx.lineCap = 'round'
      strokeOval(0)
      ctx.restore()

      // neon-pink edge lines (outer + inner)
      ctx.save()
      ctx.strokeStyle = PINK
      ctx.lineWidth = 2.5
      ctx.shadowColor = PINK
      ctx.shadowBlur = 12
      strokeOval(ROAD_HALF)
      strokeOval(-ROAD_HALF)
      ctx.restore()

      // dashed center line
      ctx.save()
      ctx.strokeStyle = 'rgba(255,255,255,0.32)'
      ctx.lineWidth = 2
      ctx.setLineDash([12, 16])
      strokeOval(0)
      ctx.restore()
    }

    function strokeOval(off) {
      ctx.beginPath()
      for (let i = 0; i <= NWP; i++) {
        const a = ((i % NWP) / NWP) * Math.PI * 2 - Math.PI / 2
        const px = CX + Math.cos(a) * (RX + off)
        const py = CY + Math.sin(a) * (RY + off)
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.stroke()
    }

    function drawStartLine() {
      // checkered start/finish across the road at checkpoint 0 (top of oval)
      const cp = checkpoints[0]
      const next = WP[(cp.wpIndex + 1) % NWP]
      const ang = Math.atan2(next.y - cp.y, next.x - cp.x)
      const px = Math.cos(ang + Math.PI / 2)
      const py = Math.sin(ang + Math.PI / 2)
      ctx.save()
      ctx.shadowColor = '#ffffff'
      ctx.shadowBlur = 10
      const squares = 6
      for (let i = 0; i < squares; i++) {
        const t = (i / (squares - 1) - 0.5) * 2 * ROAD_HALF
        ctx.fillStyle = i % 2 === 0 ? '#ffffff' : '#2a2a30'
        ctx.fillRect(cp.x + px * t - 4, cp.y + py * t - 4, 8, 8)
      }
      ctx.restore()
    }

    function drawCheckpoints() {
      ctx.save()
      for (let i = 1; i < checkpoints.length; i++) {
        const cp = checkpoints[i]
        ctx.beginPath()
        ctx.arc(cp.x, cp.y, 5, 0, Math.PI * 2)
        ctx.fillStyle = (player && i === player.nextCp) ? PINK : 'rgba(45,226,230,0.5)'
        ctx.shadowColor = (player && i === player.nextCp) ? PINK : '#2de2e6'
        ctx.shadowBlur = (player && i === player.nextCp) ? 14 : 6
        ctx.fill()
      }
      ctx.restore()
    }

    function drawCar(c) {
      ctx.save()
      ctx.translate(c.x, c.y)
      ctx.rotate(c.angle)
      ctx.shadowColor = c.color
      ctx.shadowBlur = 14
      ctx.fillStyle = c.color
      // body
      ctx.beginPath()
      ctx.roundRect ? ctx.roundRect(-9, -6, 18, 12, 3) : ctx.rect(-9, -6, 18, 12)
      ctx.fill()
      // windshield hint
      ctx.shadowBlur = 0
      ctx.fillStyle = 'rgba(10,10,10,0.65)'
      ctx.fillRect(2, -4, 4, 8)
      ctx.restore()
      ctx.shadowBlur = 0 // reset after glow
    }

    function fmt(t) {
      if (!isFinite(t) || t <= 0) return '--:--'
      const m = Math.floor(t / 60)
      const s = (t % 60)
      return `${m}:${s.toFixed(2).padStart(5, '0')}`
    }

    function drawHUD() {
      ctx.save()
      ctx.fillStyle = PINK
      ctx.font = 'bold 16px monospace'
      ctx.textBaseline = 'top'

      const lapShown = player ? Math.min(Math.max(player.lap, 1), LAPS) : 1
      const lines = [
        `LAP ${lapShown}/${LAPS}`,
        `TIME ${fmt(raceTime)}`,
        `POS ${player ? playerPlace() : 1}/4`,
      ]
      lines.forEach((t, i) => {
        const x = 14, y = 12 + i * 22
        ctx.fillText(t.toUpperCase(), x, y)
        // underline bar
        ctx.fillRect(x, y + 17, ctx.measureText(t.toUpperCase()).width, 2)
      })

      // best lap top-right
      ctx.textAlign = 'right'
      const bt = `BEST ${fmt(best)}`
      ctx.fillText(bt, W - 14, 12)
      ctx.fillRect(W - 14 - ctx.measureText(bt).width, 29, ctx.measureText(bt).width, 2)
      ctx.textAlign = 'left'

      if (auto) {
        ctx.fillStyle = 'rgba(255,45,111,0.7)'
        ctx.font = 'bold 11px monospace'
        ctx.fillText('AUTOPLAY', 14, H - 22)
      }
      ctx.restore()
    }

    function drawCenter(big, sub, sub2) {
      ctx.save()
      ctx.textAlign = 'center'
      ctx.fillStyle = PINK
      ctx.shadowColor = PINK
      ctx.shadowBlur = 16
      ctx.font = 'bold 46px monospace'
      ctx.fillText(big, CX, CY - 10)
      ctx.shadowBlur = 0
      ctx.fillStyle = '#fff'
      ctx.font = 'bold 14px monospace'
      if (sub) ctx.fillText(sub, CX, CY + 30)
      ctx.fillStyle = 'rgba(255,255,255,0.6)'
      ctx.font = '12px monospace'
      if (sub2) ctx.fillText(sub2, CX, CY + 52)
      ctx.restore()
    }

    function drawSparkles() {
      ctx.save()
      ctx.fillStyle = PINK
      ctx.font = 'bold 18px monospace'
      ctx.shadowColor = PINK
      ctx.shadowBlur = 8
      const m = 10
      ctx.fillText('+', m, m + 14)
      ctx.fillText('+', W - m - 10, m + 14)
      ctx.fillText('+', m, H - m)
      ctx.fillText('+', W - m - 10, H - m)
      ctx.restore()
    }

    resetRace()
    state = 'ready'
    if (auto) autoTimer = setTimeout(startOrRestart, 700) // kick off the first race via timer (reliable)
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(autoTimer)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      canvas.removeEventListener('pointerdown', onPointer)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      className="racing-canvas"
      aria-label="Racing game"
    />
  )
}
