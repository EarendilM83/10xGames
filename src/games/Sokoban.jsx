import { useEffect, useRef } from 'react'
import { isAutoplay, shouldAutoWin, recordAutoplayResult } from '../autoplay.js'

// Sokoban on canvas, 10x neon-on-black style.
const W = 520
const H = 560
const PAD = 18
const HEADER = 64
const PINK = '#ff2d6f'
const CYAN = '#2de2e6'
const GREEN = '#54e346'
const MUTED = '#8a93ad'
const HS_KEY = '10xgames.sokoban.best'

// Standard chars: # wall, ' ' floor, . goal, $ box, * box-on-goal, @ player, + player-on-goal
const LEVELS = [
  [
    '#####',
    '#@  #',
    '# $.#',
    '#   #',
    '#####',
  ],
  [
    '#######',
    '#  .  #',
    '# # # #',
    '# $@$ #',
    '# # # #',
    '#  .  #',
    '#######',
  ],
  [
    '########',
    '#      #',
    '#@$  ..#',
    '# $    #',
    '#      #',
    '########',
  ],
  [
    '########',
    '#  .   #',
    '# .$$@ #',
    '#  $   #',
    '#  .   #',
    '########',
  ],
  [
    '#########',
    '#       #',
    '# $$$ . #',
    '# @   . #',
    '#     . #',
    '#########',
  ],
  [
    '#######',
    '#. . .#',
    '# $$$ #',
    '#  @  #',
    '# $   #',
    '#.    #',
    '#######',
  ],
  [
    '##########',
    '#   ##   #',
    '# $    $ #',
    '#  .##.  #',
    '#@ .##.  #',
    '# $    $ #',
    '#   ##   #',
    '##########',
  ],
]

export default function Sokoban() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')

    const auto = isAutoplay('sokoban')
    // bot state
    let botPlan = []      // queued [dx,dy] moves to replay
    let botMode = 'idle'  // idle | plan | replay | wander
    let botWander = 0     // ms remaining of fumbling
    let botAcc = 0        // ms accumulator for move pacing
    let botRestart = 0    // timestamp to auto-advance after a clear
    let lastTs = 0
    const STEP_MS = 180   // smooth, steady pace between bot moves

    let levelIdx = 0
    let walls // boolean[r][c]
    let goals // boolean[r][c]
    let boxes // boolean[r][c]
    let px, py // player position
    let rows, cols
    let moves = 0
    let history = [] // stack of snapshots {boxes, px, py, moves}
    let state = 'playing' // playing | level-clear | complete
    let best = Number(localStorage.getItem(HS_KEY)) || 0
    let raf = 0

    function loadLevel(i) {
      const lvl = LEVELS[i]
      rows = lvl.length
      cols = Math.max(...lvl.map((r) => r.length))
      walls = Array.from({ length: rows }, () => new Array(cols).fill(false))
      goals = Array.from({ length: rows }, () => new Array(cols).fill(false))
      boxes = Array.from({ length: rows }, () => new Array(cols).fill(false))
      for (let r = 0; r < rows; r++) {
        const line = lvl[r]
        for (let c = 0; c < cols; c++) {
          const ch = line[c] || ' '
          if (ch === '#') walls[r][c] = true
          if (ch === '.' || ch === '*' || ch === '+') goals[r][c] = true
          if (ch === '$' || ch === '*') boxes[r][c] = true
          if (ch === '@' || ch === '+') { px = c; py = r }
        }
      }
      moves = 0
      history = []
    }

    function startLevel(i) {
      levelIdx = i
      loadLevel(i)
      state = 'playing'
    }

    function snapshot() {
      history.push({
        boxes: boxes.map((row) => row.slice()),
        px, py, moves,
      })
      if (history.length > 2000) history.shift()
    }

    function undo() {
      if (!history.length) return
      const s = history.pop()
      boxes = s.boxes
      px = s.px; py = s.py; moves = s.moves
    }

    function solved() {
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++)
          if (boxes[r][c] && !goals[r][c]) return false
      return true
    }

    function tryMove(dx, dy) {
      const nx = px + dx, ny = py + dy
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) return
      if (walls[ny][nx]) return
      if (boxes[ny][nx]) {
        // pushing a box
        const bx = nx + dx, by = ny + dy
        if (bx < 0 || by < 0 || bx >= cols || by >= rows) return
        if (walls[by][bx] || boxes[by][bx]) return // can't push into wall or second box
        snapshot()
        boxes[ny][nx] = false
        boxes[by][bx] = true
        px = nx; py = ny; moves++
      } else {
        snapshot()
        px = nx; py = ny; moves++
      }
      if (solved()) {
        if (levelIdx === LEVELS.length - 1) {
          state = 'complete'
        } else {
          state = 'level-clear'
        }
        const solvedCount = levelIdx + 1
        if (solvedCount > best) { best = solvedCount; localStorage.setItem(HS_KEY, String(best)) }
      }
    }

    // ---------- bot (autoplay) ----------
    const DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]]
    const BFS_CAP = 200000 // hard cap on explored states; bail to random if exceeded

    // Encode a state (player + sorted box cells) into a string key.
    function encode(pp, boxSet) {
      return pp + '|' + Array.from(boxSet).sort((a, b) => a - b).join(',')
    }
    function allOnGoals(boxSet) {
      for (const cell of boxSet) {
        const r = Math.floor(cell / cols), c = cell % cols
        if (!goals[r][c]) return false
      }
      return true
    }

    // BFS over (player, boxes) using the game's own push rules. Returns a move
    // list ([dx,dy]) or null if unsolvable / cap exceeded.
    function solve() {
      const startBoxes = new Set()
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++)
          if (boxes[r][c]) startBoxes.add(r * cols + c)
      const start = { p: py * cols + px, boxes: startBoxes, path: [] }
      if (allOnGoals(start.boxes)) return []

      const seen = new Set([encode(start.p, start.boxes)])
      const queue = [start]
      let explored = 0
      while (queue.length) {
        if (++explored > BFS_CAP) return null
        const cur = queue.shift()
        const pr = Math.floor(cur.p / cols), pc = cur.p % cols
        for (const [dx, dy] of DIRS) {
          const nc = pc + dx, nr = pr + dy
          if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue
          if (walls[nr][nc]) continue
          const nCell = nr * cols + nc
          let nextBoxes = cur.boxes
          if (cur.boxes.has(nCell)) {
            // would push a box; same rules as tryMove
            const bc = nc + dx, br = nr + dy
            if (bc < 0 || br < 0 || bc >= cols || br >= rows) continue
            if (walls[br][bc]) continue
            const bCell = br * cols + bc
            if (cur.boxes.has(bCell)) continue // can't push two boxes
            nextBoxes = new Set(cur.boxes)
            nextBoxes.delete(nCell)
            nextBoxes.add(bCell)
          }
          const key = encode(nCell, nextBoxes)
          if (seen.has(key)) continue
          seen.add(key)
          const path = cur.path.concat([[dx, dy]])
          if (nextBoxes !== cur.boxes && allOnGoals(nextBoxes)) return path
          queue.push({ p: nCell, boxes: nextBoxes, path })
        }
      }
      return null
    }

    // Decide what to do at the start of a level: solve it, or fumble then reset.
    function botPlanLevel() {
      const wantWin = shouldAutoWin('sokoban')
      const sol = solve()
      if (wantWin && sol) {
        // WIN round: replay the BFS solution to solve the level (~95%).
        botPlan = sol
        botMode = 'replay'
      } else if (wantWin) {
        // WIN round but BFS hit the cap / unsolvable: can't solve → treat as reset (lose).
        botMode = 'wander'
        botWander = 2000 + Math.random() * 600
      } else {
        // LOSE round (~5%): fumble a few random moves, then reset.
        botMode = 'wander'
        botWander = 2000 + Math.random() * 600
      }
      botAcc = 0
    }

    function botStep(now) {
      if (state === 'level-clear') {
        if (!botRestart) botRestart = now + 1000
        else if (now >= botRestart) { botRestart = 0; startLevel(levelIdx + 1); botPlanLevel() }
        return
      }
      if (state === 'complete') {
        if (!botRestart) botRestart = now + 1300
        else if (now >= botRestart) { botRestart = 0; startLevel(0); botPlanLevel() }
        return
      }
      if (botMode === 'idle') { botPlanLevel(); return }

      botAcc += now - lastTs
      if (botAcc < STEP_MS) return
      botAcc = 0

      if (botMode === 'replay') {
        if (botPlan.length) {
          const [dx, dy] = botPlan.shift()
          tryMove(dx, dy)
          // A successful replay that completes the level counts as a solved session.
          if (state === 'level-clear' || state === 'complete') {
            recordAutoplayResult('sokoban', true)
            botMode = 'idle'
          }
        } else {
          // Ran out of moves without solving (shouldn't happen for a valid plan) → reset, lose.
          recordAutoplayResult('sokoban', false)
          loadLevel(levelIdx); botPlanLevel()
        }
      } else if (botMode === 'wander') {
        const [dx, dy] = DIRS[Math.floor(Math.random() * DIRS.length)]
        tryMove(dx, dy)
        botWander -= STEP_MS
        // If random fumbling happens to clear the level, the state handler advances; count it.
        if (state === 'level-clear' || state === 'complete') {
          recordAutoplayResult('sokoban', true)
          botMode = 'idle'
        } else if (botWander <= 0) {
          // LOSE round: reset the level, counts as not-solved.
          recordAutoplayResult('sokoban', false)
          loadLevel(levelIdx); botPlanLevel()
        }
      }
    }

    // ---------- input ----------
    function onKey(e) {
      const k = e.code
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) e.preventDefault()

      if (state === 'level-clear') {
        if (['Space', 'Enter'].includes(k)) { e.preventDefault(); startLevel(levelIdx + 1) }
        return
      }
      if (state === 'complete') {
        if (['Space', 'Enter', 'KeyR'].includes(k)) { e.preventDefault(); startLevel(0) }
        return
      }
      // playing
      if (k === 'KeyZ') { e.preventDefault(); undo(); return }
      if (k === 'KeyR') { e.preventDefault(); loadLevel(levelIdx); return }
      let dx = 0, dy = 0
      if (k === 'ArrowUp' || k === 'KeyW') dy = -1
      else if (k === 'ArrowDown' || k === 'KeyS') dy = 1
      else if (k === 'ArrowLeft' || k === 'KeyA') dx = -1
      else if (k === 'ArrowRight' || k === 'KeyD') dx = 1
      else return
      tryMove(dx, dy)
    }
    function onPointer() {
      if (state === 'level-clear') startLevel(levelIdx + 1)
      else if (state === 'complete') startLevel(0)
    }
    window.addEventListener('keydown', onKey)
    canvas.addEventListener('pointerdown', onPointer)

    // ---------- drawing ----------
    function roundRect(x, y, w, h, r) {
      ctx.beginPath()
      ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r)
      ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r)
      ctx.arcTo(x, y, x + w, y, r); ctx.closePath()
    }
    function sparkle(x, y, s) {
      ctx.strokeStyle = PINK; ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(x - s, y); ctx.lineTo(x + s, y); ctx.moveTo(x, y - s); ctx.lineTo(x, y + s); ctx.stroke()
    }

    // compute board geometry (centered & scaled in available area)
    function geom() {
      const availW = W - PAD * 2
      const availH = H - PAD - HEADER - PAD
      const tile = Math.floor(Math.min(availW / cols, availH / rows))
      const bw = tile * cols, bh = tile * rows
      const ox = Math.floor((W - bw) / 2)
      const oy = Math.floor(HEADER + (availH - bh) / 2) + PAD
      return { tile, ox, oy, bw, bh }
    }

    function draw(now) {
      ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, W, H)
      sparkle(W - 26, 22, 5); sparkle(26, H - 26, 4)

      // header
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
      ctx.fillStyle = PINK; ctx.font = '700 12px system-ui, sans-serif'
      ctx.fillText('LEVEL', PAD, PAD + 12); ctx.fillRect(PAD, PAD + 17, 22, 3)
      ctx.fillStyle = '#fff'; ctx.font = '800 26px system-ui, sans-serif'
      ctx.fillText(`${levelIdx + 1}/${LEVELS.length}`, PAD, PAD + 46)

      ctx.textAlign = 'center'
      ctx.fillStyle = PINK; ctx.font = '700 12px system-ui, sans-serif'
      ctx.fillText('MOVES', W / 2, PAD + 12); ctx.fillRect(W / 2 - 11, PAD + 17, 22, 3)
      ctx.fillStyle = '#fff'; ctx.font = '800 26px system-ui, sans-serif'
      ctx.fillText(String(moves), W / 2, PAD + 46)

      ctx.textAlign = 'right'
      ctx.fillStyle = MUTED; ctx.font = '600 12px system-ui, sans-serif'
      ctx.fillText('BEST', W - PAD, PAD + 12)
      ctx.fillStyle = '#fff'; ctx.font = '800 22px system-ui, sans-serif'
      ctx.fillText(String(best), W - PAD, PAD + 44)

      const { tile, ox, oy } = geom()

      // floor backdrop
      ctx.fillStyle = '#101019'
      ctx.fillRect(ox, oy, tile * cols, tile * rows)

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = ox + c * tile, y = oy + r * tile
          if (walls[r][c]) {
            // dark neon-edged wall block
            ctx.fillStyle = '#1c1c2a'
            roundRect(x + 1, y + 1, tile - 2, tile - 2, 4); ctx.fill()
            ctx.shadowColor = '#3a3a66'; ctx.shadowBlur = 6
            ctx.strokeStyle = '#444a8a'; ctx.lineWidth = 1.5
            roundRect(x + 1.5, y + 1.5, tile - 3, tile - 3, 4); ctx.stroke()
            ctx.shadowBlur = 0
            continue
          }
          // subtle floor
          ctx.fillStyle = 'rgba(255,255,255,0.025)'
          ctx.fillRect(x + 1, y + 1, tile - 2, tile - 2)

          // goal marker: glowing pink ring
          if (goals[r][c]) {
            const cx = x + tile / 2, cy = y + tile / 2
            ctx.shadowColor = PINK; ctx.shadowBlur = 10
            ctx.strokeStyle = PINK; ctx.lineWidth = 2
            ctx.beginPath(); ctx.arc(cx, cy, tile * 0.18, 0, Math.PI * 2); ctx.stroke()
            ctx.shadowBlur = 0
          }
        }
      }

      // boxes (drawn after goals so they sit on top)
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (!boxes[r][c]) continue
          const x = ox + c * tile, y = oy + r * tile
          const onGoal = goals[r][c]
          const col = onGoal ? GREEN : CYAN
          const m = Math.max(3, tile * 0.12)
          ctx.shadowColor = col; ctx.shadowBlur = onGoal ? 16 : 10
          ctx.fillStyle = col
          roundRect(x + m, y + m, tile - 2 * m, tile - 2 * m, 4); ctx.fill()
          ctx.shadowBlur = 0
          // crate cross detail
          ctx.strokeStyle = 'rgba(10,10,10,0.5)'; ctx.lineWidth = 1.5
          ctx.beginPath()
          ctx.moveTo(x + m, y + m); ctx.lineTo(x + tile - m, y + tile - m)
          ctx.moveTo(x + tile - m, y + m); ctx.lineTo(x + m, y + tile - m)
          ctx.stroke()
        }
      }

      // player: glowing pink
      {
        const x = ox + px * tile, y = oy + py * tile
        const cx = x + tile / 2, cy = y + tile / 2
        ctx.shadowColor = PINK; ctx.shadowBlur = 16
        ctx.fillStyle = PINK
        ctx.beginPath(); ctx.arc(cx, cy, tile * 0.3, 0, Math.PI * 2); ctx.fill()
        ctx.shadowBlur = 0
        ctx.fillStyle = 'rgba(255,255,255,0.85)'
        ctx.beginPath(); ctx.arc(cx, cy, tile * 0.12, 0, Math.PI * 2); ctx.fill()
      }

      if (state === 'level-clear') {
        // brief banner, auto-hints to continue
        overlay('LEVEL CLEAR', 'space / tap → next level')
      } else if (state === 'complete') {
        overlay('ALL CLEAR', 'space / tap → play again')
      } else {
        // controls hint
        ctx.textAlign = 'center'; ctx.fillStyle = MUTED; ctx.font = '600 11px system-ui, sans-serif'
        ctx.fillText('ARROWS / WASD move · Z undo · R reset', W / 2, H - 8)
      }
    }

    function overlay(title, sub) {
      ctx.fillStyle = 'rgba(10,10,10,0.82)'; ctx.fillRect(0, HEADER, W, H - HEADER)
      ctx.textAlign = 'center'
      ctx.shadowColor = PINK; ctx.shadowBlur = 18
      ctx.fillStyle = PINK; ctx.font = '800 46px system-ui, sans-serif'
      ctx.fillText(title, W / 2, H / 2 - 4)
      ctx.shadowBlur = 0
      ctx.fillStyle = PINK; ctx.fillRect(W / 2 - 70, H / 2 + 12, 140, 4)
      ctx.fillStyle = '#fff'; ctx.font = '600 14px system-ui, sans-serif'
      ctx.fillText(sub, W / 2, H / 2 + 44)
    }

    function loop(now) {
      if (auto) { if (!lastTs) lastTs = now; botStep(now); lastTs = now }
      draw(now)
      raf = requestAnimationFrame(loop)
    }

    startLevel(0)
    if (auto) botPlanLevel()
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKey)
      canvas.removeEventListener('pointerdown', onPointer)
    }
  }, [])

  return (
    <canvas ref={canvasRef} width={W} height={H} className="sokoban-canvas" aria-label="Sokoban game" />
  )
}
