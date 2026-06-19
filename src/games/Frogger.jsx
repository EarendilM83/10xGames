import { useEffect, useRef } from 'react'
import { isAutoplay, shouldAutoWin, recordAutoplayResult } from '../autoplay.js'

// Frogger on canvas, 10x neon-on-black style.
// Grid: 13 cols x 14 rows of 36px. Row layout (top -> bottom):
//   row 0       : goal slots (lily pads)
//   rows 1-5    : river lanes (logs/turtles — ride them)
//   row 6       : safe median
//   rows 7-12   : road lanes (cars/trucks — avoid)
//   row 13      : safe start
const COLS = 13
const ROWS = 14
const TILE = 36
const HEADER = 44
const PAD = 14
const W = COLS * TILE
const H = ROWS * TILE + HEADER

const PINK = '#ff2d6f'
const FROG = '#54e346'
const HS_KEY = '10xgames.frogger.best'

// goal slots centered on these columns
const GOAL_COLS = [1, 4, 6, 8, 11]

export default function Frogger() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')

    const auto = isAutoplay('frogger')
    let wantWin = true, restartAt = 0, hopAcc = 0, hopGap = 500
    // win session = completed a level (filled all pads) OR score >= threshold
    const WIN_SCORE = 800
    let reachedGoalThisSession = false, recorded = false

    let frog, lanes, goals, score, lives, level, state, best, deathFlash
    best = Number(localStorage.getItem(HS_KEY)) || 0
    let last = performance.now(), raf = 0

    // y pixel for a given grid row (0 = top playfield row)
    const rowY = (r) => HEADER + r * TILE

    // build the moving-object lanes for the current level
    function buildLanes() {
      const spd = 1 + (level - 1) * 0.35 // global speed multiplier per level
      lanes = []
      // ---- RIVER lanes (rows 1-5): type 'river', objects you ride ----
      const river = [
        { row: 1, dir: 1, speed: 40, kind: 'turtle', len: 3, gap: 3, count: 2 },
        { row: 2, dir: -1, speed: 55, kind: 'log', len: 4, gap: 4, count: 2 },
        { row: 3, dir: 1, speed: 70, kind: 'log', len: 2, gap: 3, count: 3 },
        { row: 4, dir: -1, speed: 45, kind: 'turtle', len: 3, gap: 4, count: 2 },
        { row: 5, dir: 1, speed: 60, kind: 'log', len: 4, gap: 5, count: 2 },
      ]
      // ---- ROAD lanes (rows 7-12): type 'road', objects that kill ----
      const road = [
        { row: 7, dir: -1, speed: 65, kind: 'car', color: '#ff2d6f', len: 1, gap: 3, count: 3 },
        { row: 8, dir: 1, speed: 90, kind: 'car', color: '#ffd60a', len: 1, gap: 4, count: 2 },
        { row: 9, dir: -1, speed: 50, kind: 'truck', color: '#2de2e6', len: 2, gap: 4, count: 2 },
        { row: 10, dir: 1, speed: 75, kind: 'car', color: '#ff9f1c', len: 1, gap: 3, count: 3 },
        { row: 11, dir: -1, speed: 110, kind: 'car', color: '#b14aed', len: 1, gap: 5, count: 2 },
        { row: 12, dir: 1, speed: 60, kind: 'truck', color: '#ff2d6f', len: 2, gap: 5, count: 2 },
      ]
      for (const def of river) lanes.push(makeLane(def, 'river', spd))
      for (const def of road) lanes.push(makeLane(def, 'road', spd))
    }

    function makeLane(def, type, spd) {
      const stride = def.len + def.gap // tiles between object starts
      const objs = []
      for (let i = 0; i < def.count; i++) {
        objs.push({ x: i * stride * TILE })
      }
      return {
        type,
        row: def.row,
        dir: def.dir,
        speed: def.speed * spd,
        len: def.len,
        kind: def.kind,
        color: def.color,
        stride: stride * TILE,
        span: def.count * stride * TILE, // wrap width
        objs,
      }
    }

    function resetFrog() {
      frog = { col: 6, row: 13, px: 6 * TILE, onLane: null }
      deathFlash = 0
    }

    function newLevel() {
      goals = GOAL_COLS.map(() => false)
      buildLanes()
      resetFrog()
    }

    function reset() {
      score = 0
      lives = 3
      level = 1
      state = 'ready'
      newLevel()
    }

    function loseLife() {
      lives--
      deathFlash = 0.5
      if (lives <= 0) {
        state = 'over'
        if (score > best) { best = score; localStorage.setItem(HS_KEY, String(best)) }
        if (auto && !recorded) {
          recorded = true
          const won = reachedGoalThisSession || score >= WIN_SCORE
          recordAutoplayResult('frogger', won === true)
        }
      } else {
        resetFrog()
      }
    }

    function fillGoal(idx) {
      goals[idx] = true
      score += 100
      if (goals.every(Boolean)) {
        score += 500
        reachedGoalThisSession = true // completed a full level
        level++
        if (score > best) { best = score; localStorage.setItem(HS_KEY, String(best)) }
        newLevel()
        state = 'playing'
      } else {
        resetFrog()
      }
    }

    // ---------- update ----------
    function update(dt) {
      // move lane objects
      for (const lane of lanes) {
        for (const o of lane.objs) {
          o.x += lane.dir * lane.speed * dt
          // wrap within the lane span so objects keep flowing
          if (lane.dir > 0 && o.x > W + TILE) o.x -= lane.span
          if (lane.dir < 0 && o.x < -lane.len * TILE - TILE) o.x += lane.span
        }
      }

      if (state !== 'playing') return
      if (deathFlash > 0) { deathFlash -= dt; return }

      const r = frog.row
      const lane = lanes.find((l) => l.row === r)

      if (lane && lane.type === 'river') {
        // must be riding an object
        let riding = null
        const fx = frog.px
        for (const o of lane.objs) {
          if (fx + TILE * 0.5 > o.x && fx + TILE * 0.5 < o.x + lane.len * TILE) {
            riding = o; break
          }
        }
        if (!riding) { loseLife(); return }
        // carried by the object
        frog.px += lane.dir * lane.speed * dt
        if (frog.px < -TILE * 0.5 || frog.px > W - TILE * 0.5) { loseLife(); return }
        frog.col = Math.round(frog.px / TILE)
      } else if (lane && lane.type === 'road') {
        // touching a vehicle kills
        const fx = frog.px
        for (const o of lane.objs) {
          if (fx + TILE * 0.7 > o.x && fx + TILE * 0.3 < o.x + lane.len * TILE) {
            loseLife(); return
          }
        }
      }
    }

    // ---------- input ----------
    function hop(dc, dr) {
      if (deathFlash > 0) return
      const nc = frog.col + dc
      const nr = frog.row + dr
      if (nc < 0 || nc >= COLS || nr < 0 || nr > 13) return
      frog.col = nc
      frog.row = nr
      frog.px = nc * TILE
      if (dr < 0) score += 5 // small reward for forward progress
      // reached the goal row
      if (nr === 0) {
        // must land on an empty lily pad slot
        const idx = GOAL_COLS.indexOf(nc)
        if (idx >= 0 && !goals[idx]) fillGoal(idx)
        else loseLife()
      }
    }

    // ---------- autoplay bot ----------
    // Is the tile (col, row) safe to be standing on RIGHT NOW?
    // road: no vehicle overlapping the tile. river: a log/turtle is under the tile.
    // safe rows (median/start/goal-empty) are always fine.
    // lead = seconds of look-ahead applied to moving objects before testing overlap.
    function tileSafe(col, row, lead = 0.18) {
      if (col < 0 || col >= COLS || row < 0 || row > 13) return false
      const lane = lanes.find((l) => l.row === row)
      const tx = col * TILE
      if (!lane) {
        // goal row 0: only an empty lily-pad slot is safe
        if (row === 0) { const i = GOAL_COLS.indexOf(col); return i >= 0 && !goals[i] }
        return true // median / start
      }
      if (lane.type === 'road') {
        // treat the tile as occupied if a car is on it now or sliding onto it soon.
        const off = lane.dir * lane.speed * lead
        for (const o of lane.objs) {
          const ox = o.x + off
          if (tx + TILE * 0.7 > ox && tx + TILE * 0.3 < ox + lane.len * TILE) return false
        }
        return true
      }
      // river: safe only if a log/turtle will be under the tile center after lead time,
      // with margin so the frog isn't landing on the very edge of an object.
      const off = lane.dir * lane.speed * lead
      for (const o of lane.objs) {
        const ox = o.x + off
        if (tx + TILE * 0.5 > ox + TILE * 0.25 && tx + TILE * 0.5 < ox + lane.len * TILE - TILE * 0.25) return true
      }
      return false
    }

    // Pick the nearest empty goal column to steer toward on the upper river.
    function nearestGoalCol() {
      let best = null, bestD = Infinity
      for (let i = 0; i < GOAL_COLS.length; i++) {
        if (goals[i]) continue
        const d = Math.abs(GOAL_COLS[i] - frog.col)
        if (d < bestD) { bestD = d; best = GOAL_COLS[i] }
      }
      return best
    }

    function botStep() {
      if (state !== 'playing' || deathFlash > 0) return

      // LOSE rounds: charge forward ignoring safety so the frog dies fast.
      if (!wantWin) { hop(0, -1); return }

      const onRiver = lanes.find((l) => l.row === frog.row && l.type === 'river')

      // ---- WIN logic ----
      // On the river the frog is carried; keep it on the board, then climb.
      if (onRiver) {
        // approaching the goal row: line up under the nearest empty pad before hopping up.
        if (frog.row === 1) {
          const gc = nearestGoalCol()
          if (gc != null && gc !== frog.col) {
            const dir = gc > frog.col ? 1 : -1
            if (tileSafe(frog.col + dir, frog.row)) { hop(dir, 0); return }
          }
        }
        // climb if the tile above is (and will stay) safe.
        if (tileSafe(frog.col, frog.row - 1)) { hop(0, -1); return }
        // drifting toward an edge? step back toward center to avoid being carried off.
        const margin = 2
        if (frog.col <= margin && tileSafe(frog.col + 1, frog.row)) { hop(1, 0); return }
        if (frog.col >= COLS - 1 - margin && tileSafe(frog.col - 1, frog.row)) { hop(-1, 0); return }
        // otherwise ride and wait for the tile above to clear.
        return
      }

      // On safe rows / road: climb only when the tile above is safe.
      if (tileSafe(frog.col, frog.row - 1)) {
        // about to enter the river? make sure there's a board to land on.
        hop(0, -1); return
      }
      // up blocked: edge toward the nearest empty goal column while waiting,
      // but only onto a currently-safe tile.
      const gc = nearestGoalCol()
      if (gc != null && gc !== frog.col) {
        const dir = gc > frog.col ? 1 : -1
        if (tileSafe(frog.col + dir, frog.row)) { hop(dir, 0); return }
      }
      // else try any safe sidestep so we don't stall forever.
      const left = tileSafe(frog.col - 1, frog.row)
      const right = tileSafe(frog.col + 1, frog.row)
      if (left && right) hop(Math.random() < 0.5 ? -1 : 1, 0)
      else if (left) hop(-1, 0)
      else if (right) hop(1, 0)
      // otherwise hold position and wait for an opening.
    }

    function onKey(e) {
      const k = e.code
      if (state !== 'playing') {
        if (['Space', 'Enter', 'KeyR'].includes(k)) {
          e.preventDefault()
          if (state === 'over') reset()
          state = 'playing'
        }
        return
      }
      let moved = true
      if (k === 'ArrowUp' || k === 'KeyW') hop(0, -1)
      else if (k === 'ArrowDown' || k === 'KeyS') hop(0, 1)
      else if (k === 'ArrowLeft' || k === 'KeyA') hop(-1, 0)
      else if (k === 'ArrowRight' || k === 'KeyD') hop(1, 0)
      else if (k === 'KeyP') { state = 'paused'; moved = false }
      else moved = false
      if (moved || ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) e.preventDefault()
    }
    function onPointer() {
      if (state === 'over') { reset(); state = 'playing' }
      else if (state === 'ready' || state === 'paused') state = 'playing'
    }
    window.addEventListener('keydown', onKey)
    canvas.addEventListener('pointerdown', onPointer)

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

    function draw() {
      // bg
      ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, W, H)

      // ---- header: SCORE / LIVES / BEST ----
      ctx.textAlign = 'left'
      ctx.fillStyle = PINK; ctx.font = '700 11px system-ui, sans-serif'
      ctx.fillText('SCORE', PAD, 16); ctx.fillRect(PAD, 21, 22, 3)
      ctx.fillStyle = '#fff'; ctx.font = '800 20px system-ui, sans-serif'
      ctx.fillText(String(score), PAD, 40)

      ctx.textAlign = 'center'
      ctx.fillStyle = PINK; ctx.font = '700 11px system-ui, sans-serif'
      ctx.fillText('LIVES', W / 2, 16); ctx.fillRect(W / 2 - 11, 21, 22, 3)
      ctx.fillStyle = FROG; ctx.font = '800 18px system-ui, sans-serif'
      ctx.fillText('♥ '.repeat(Math.max(0, lives)).trim() || '—', W / 2, 39)

      ctx.textAlign = 'right'
      ctx.fillStyle = '#8a93ad'; ctx.font = '600 11px system-ui, sans-serif'
      ctx.fillText('BEST  ' + best, W - PAD, 16)
      ctx.fillStyle = '#8a93ad'; ctx.font = '600 11px system-ui, sans-serif'
      ctx.fillText('LVL  ' + level, W - PAD, 32)

      // ---- lane bands ----
      // goal row 0 (dark green)
      ctx.fillStyle = '#0c1a0c'; ctx.fillRect(0, rowY(0), W, TILE)
      // river rows 1-5 (dark blue)
      ctx.fillStyle = '#0b1626'; ctx.fillRect(0, rowY(1), W, TILE * 5)
      // median row 6 (purple-ish safe)
      ctx.fillStyle = '#16121f'; ctx.fillRect(0, rowY(6), W, TILE)
      // road rows 7-12 (dark gray)
      ctx.fillStyle = '#131316'; ctx.fillRect(0, rowY(7), W, TILE * 6)
      // start row 13 (purple-ish safe)
      ctx.fillStyle = '#16121f'; ctx.fillRect(0, rowY(13), W, TILE)

      // road dashed lane separators
      ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 2
      ctx.setLineDash([10, 12])
      for (let r = 8; r <= 12; r++) {
        const y = rowY(r)
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke()
      }
      ctx.setLineDash([])

      // ---- goal slots (lily pads) ----
      for (let i = 0; i < GOAL_COLS.length; i++) {
        const cx = GOAL_COLS[i] * TILE + TILE / 2
        const cy = rowY(0) + TILE / 2
        if (goals[i]) {
          ctx.shadowColor = FROG; ctx.shadowBlur = 12
          ctx.fillStyle = FROG
          drawFrogShape(GOAL_COLS[i] * TILE, rowY(0))
          ctx.shadowBlur = 0
        } else {
          ctx.fillStyle = 'rgba(84,227,70,0.12)'
          ctx.beginPath(); ctx.arc(cx, cy, TILE * 0.38, 0, Math.PI * 2); ctx.fill()
          ctx.strokeStyle = 'rgba(84,227,70,0.55)'; ctx.lineWidth = 2
          ctx.beginPath(); ctx.arc(cx, cy, TILE * 0.38, 0, Math.PI * 2); ctx.stroke()
        }
      }

      // ---- lane objects ----
      for (const lane of lanes) {
        const y = rowY(lane.row)
        for (const o of lane.objs) {
          const w = lane.len * TILE
          if (lane.type === 'river') {
            if (lane.kind === 'log') {
              ctx.shadowColor = '#b1672e'; ctx.shadowBlur = 8
              ctx.fillStyle = '#8a5a3c'
              roundRect(o.x + 2, y + 6, w - 4, TILE - 12, 8); ctx.fill()
              ctx.fillStyle = '#b1672e'
              roundRect(o.x + 4, y + 8, w - 8, 4, 2); ctx.fill()
              ctx.shadowBlur = 0
            } else { // turtle
              ctx.shadowColor = '#54e346'; ctx.shadowBlur = 8
              ctx.fillStyle = '#2e7d32'
              for (let t = 0; t < lane.len; t++) {
                const tx = o.x + t * TILE + TILE / 2
                ctx.beginPath(); ctx.arc(tx, y + TILE / 2, TILE * 0.34, 0, Math.PI * 2); ctx.fill()
              }
              ctx.shadowBlur = 0
            }
          } else { // road vehicle
            ctx.shadowColor = lane.color; ctx.shadowBlur = 10
            ctx.fillStyle = lane.color
            roundRect(o.x + 3, y + 5, w - 6, TILE - 10, 6); ctx.fill()
            ctx.fillStyle = 'rgba(255,255,255,0.35)'
            roundRect(o.x + 6, y + 8, Math.max(4, w - 12), 5, 3); ctx.fill()
            ctx.shadowBlur = 0
          }
        }
      }

      // ---- frog ----
      if (state !== 'over' || lives > 0) {
        const fx = frog.px
        const fy = rowY(frog.row)
        if (deathFlash > 0) {
          ctx.shadowColor = PINK; ctx.shadowBlur = 16
          ctx.fillStyle = PINK
        } else {
          ctx.shadowColor = FROG; ctx.shadowBlur = 14
          ctx.fillStyle = FROG
        }
        drawFrogShape(fx, fy)
        ctx.shadowBlur = 0
      }

      // corner sparkles
      sparkle(W - 24, HEADER + 18, 5)
      sparkle(24, H - 22, 4)

      // ---- overlays ----
      if (state === 'ready') overlay('FROGGER', 'arrows / WASD to hop — space to start')
      else if (state === 'paused') overlay('PAUSED', 'press space to resume')
      else if (state === 'over') overlay('GAME OVER', 'tap / space to play again')
    }

    function drawFrogShape(x, y) {
      // body
      ctx.beginPath(); ctx.arc(x + TILE / 2, y + TILE / 2, TILE * 0.32, 0, Math.PI * 2); ctx.fill()
      // legs
      roundRect(x + 4, y + 6, 7, 12, 3); ctx.fill()
      roundRect(x + TILE - 11, y + 6, 7, 12, 3); ctx.fill()
      roundRect(x + 4, y + TILE - 16, 7, 12, 3); ctx.fill()
      roundRect(x + TILE - 11, y + TILE - 16, 7, 12, 3); ctx.fill()
      // eyes
      const prev = ctx.fillStyle
      ctx.fillStyle = '#0a0a0a'
      ctx.beginPath(); ctx.arc(x + TILE / 2 - 6, y + TILE / 2 - 6, 2.5, 0, Math.PI * 2); ctx.fill()
      ctx.beginPath(); ctx.arc(x + TILE / 2 + 6, y + TILE / 2 - 6, 2.5, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = prev
    }

    function overlay(title, sub) {
      ctx.fillStyle = 'rgba(10,10,10,0.82)'
      ctx.fillRect(0, HEADER, W, H - HEADER)
      ctx.textAlign = 'center'
      ctx.fillStyle = PINK; ctx.font = '800 34px system-ui, sans-serif'
      ctx.fillText(title, W / 2, H / 2 - 6)
      ctx.fillStyle = PINK; ctx.fillRect(W / 2 - 55, H / 2 + 6, 110, 4)
      ctx.fillStyle = '#fff'; ctx.font = '600 13px system-ui, sans-serif'
      ctx.fillText(sub, W / 2, H / 2 + 34)
    }

    function newRound() {
      reset()
      wantWin = shouldAutoWin('frogger')
      reachedGoalThisSession = false
      recorded = false
      state = 'playing'
      hopAcc = 0
      // steady, watchable hop cadence (not frantic)
      hopGap = 320 + Math.random() * 120
    }

    function loop(now) {
      let dt = (now - last) / 1000
      last = now
      if (dt > 0.05) dt = 0.05 // clamp delta

      if (auto) {
        if (state === 'ready') { state = 'playing'; hopAcc = 0 }
        else if (state === 'over') {
          if (!restartAt) restartAt = now + 1300
          else if (now >= restartAt) { restartAt = 0; newRound() }
        }
        if (state === 'playing' && deathFlash <= 0) {
          if (score >= WIN_SCORE) reachedGoalThisSession = true
          hopAcc += dt * 1000
          if (hopAcc >= hopGap) { hopAcc = 0; hopGap = 320 + Math.random() * 120; botStep() }
        }
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
      canvas.removeEventListener('pointerdown', onPointer)
    }
  }, [])

  return (
    <canvas ref={canvasRef} width={W} height={H} className="frogger-canvas" aria-label="Frogger game" />
  )
}
