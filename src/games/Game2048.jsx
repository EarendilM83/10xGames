import { useEffect, useRef } from 'react'
import { isAutoplay, shouldAutoWin, recordAutoplayResult } from '../autoplay.js'

// 2048 on canvas, 10x neon-on-black style.
const N = 4
const CELL = 96
const GAP = 12
const PAD = 18
const HEADER = 60
const BOARD = N * CELL + (N + 1) * GAP
const BOARD_X = PAD
const BOARD_Y = PAD + HEADER + 8
const W = PAD * 2 + BOARD
const H = BOARD_Y + BOARD + PAD

const PINK = '#ff2d6f'
const HS_KEY = '10xgames.2048.best'

// value → tile color + text color (neon ramp toward pink at 2048)
const TILE = {
  2: ['#23232c', '#f5f6fa'], 4: ['#2e2740', '#f5f6fa'],
  8: ['#6d4dff', '#fff'], 16: ['#8b3df0', '#fff'],
  32: ['#b14aed', '#fff'], 64: ['#4d7cff', '#fff'],
  128: ['#2de2e6', '#06222a'], 256: ['#2ee6a0', '#06251b'],
  512: ['#ffd60a', '#1a1500'], 1024: ['#ff8a1e', '#2a1400'],
  2048: ['#ff2d6f', '#fff'],
}
const tileColors = (v) => TILE[v] || ['#ec1f4e', '#fff']

export default function Game2048() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const auto = isAutoplay('2048')

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')

    let board, score, state, wonAck, best
    best = Number(localStorage.getItem(HS_KEY)) || 0
    let pops = [] // {r,c,t} scale-pop animations
    let raf = 0

    function reset() {
      board = Array.from({ length: N }, () => new Array(N).fill(0))
      score = 0; state = 'playing'; wonAck = false; pops = []
      spawn(); spawn()
    }

    function emptyCells() {
      const out = []
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (board[r][c] === 0) out.push([r, c])
      return out
    }

    function spawn() {
      const empty = emptyCells()
      if (!empty.length) return
      const [r, c] = empty[Math.floor(Math.random() * empty.length)]
      board[r][c] = Math.random() < 0.9 ? 2 : 4
      pops.push({ r, c, t: performance.now() })
    }

    // slide one line left; returns { line, mergedIdx[] }
    function slideLeft(line) {
      const arr = line.filter((v) => v !== 0)
      const out = []
      const mergedIdx = []
      let i = 0
      while (i < arr.length) {
        if (i + 1 < arr.length && arr[i] === arr[i + 1]) {
          const v = arr[i] * 2
          out.push(v); score += v; mergedIdx.push(out.length - 1); i += 2
        } else { out.push(arr[i]); i++ }
      }
      while (out.length < N) out.push(0)
      return { line: out, mergedIdx }
    }

    function coords(dir, i, j) {
      if (dir === 'L') return [i, j]
      if (dir === 'R') return [i, N - 1 - j]
      if (dir === 'U') return [j, i]
      return [N - 1 - j, i] // D
    }

    function move(dir) {
      let changed = false
      const merges = []
      for (let i = 0; i < N; i++) {
        const line = []
        for (let j = 0; j < N; j++) { const [r, c] = coords(dir, i, j); line.push(board[r][c]) }
        const { line: merged, mergedIdx } = slideLeft(line)
        for (let j = 0; j < N; j++) {
          const [r, c] = coords(dir, i, j)
          if (board[r][c] !== merged[j]) changed = true
          board[r][c] = merged[j]
        }
        for (const j of mergedIdx) merges.push(coords(dir, i, j))
      }
      if (!changed) return
      for (const [r, c] of merges) pops.push({ r, c, t: performance.now() })
      if (score > best) { best = score; localStorage.setItem(HS_KEY, String(best)) }
      spawn()
      if (!wonAck && board.some((row) => row.some((v) => v >= 2048))) state = 'won'
      else if (isStuck()) state = 'over'
    }

    function isStuck() {
      if (emptyCells().length) return false
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
        if (c + 1 < N && board[r][c] === board[r][c + 1]) return false
        if (r + 1 < N && board[r][c] === board[r + 1][c]) return false
      }
      return true
    }

    // ---------- input ----------
    function onKey(e) {
      const k = e.code
      if (state === 'over') { if (['Space', 'Enter', 'KeyR'].includes(k)) { e.preventDefault(); reset() } return }
      if (state === 'won') {
        if (['Space', 'Enter'].includes(k)) { e.preventDefault(); wonAck = true; state = 'playing' }
        else if (k === 'KeyR') { e.preventDefault(); reset() }
        return
      }
      let dir = null
      if (k === 'ArrowLeft' || k === 'KeyA') dir = 'L'
      else if (k === 'ArrowRight' || k === 'KeyD') dir = 'R'
      else if (k === 'ArrowUp' || k === 'KeyW') dir = 'U'
      else if (k === 'ArrowDown' || k === 'KeyS') dir = 'D'
      else if (k === 'KeyR') { e.preventDefault(); reset(); return }
      if (dir) { e.preventDefault(); move(dir) }
    }
    function onPointer() { if (state === 'over') reset() }
    window.addEventListener('keydown', onKey)
    canvas.addEventListener('pointerdown', onPointer)

    // ---------- drawing ----------
    function roundRect(x, y, w, h, r) {
      ctx.beginPath()
      ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r)
      ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r)
      ctx.arcTo(x, y, x + w, y, r); ctx.closePath()
    }
    function cellXY(r, c) {
      return [BOARD_X + GAP + c * (CELL + GAP), BOARD_Y + GAP + r * (CELL + GAP)]
    }
    function sparkle(x, y, s) {
      ctx.strokeStyle = PINK; ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(x - s, y); ctx.lineTo(x + s, y); ctx.moveTo(x, y - s); ctx.lineTo(x, y + s); ctx.stroke()
    }
    function popScale(r, c, now) {
      let s = 1
      for (const p of pops) {
        if (p.r === r && p.c === c) {
          const dt = now - p.t
          if (dt < 130) s = 0.6 + 0.4 * (dt / 130)
        }
      }
      return s
    }

    function draw(now) {
      ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, W, H)
      sparkle(W - 26, 22, 5); sparkle(26, H - 26, 4)

      // header: SCORE + BEST
      ctx.fillStyle = PINK; ctx.font = '700 12px system-ui, sans-serif'; ctx.textAlign = 'left'
      ctx.fillText('SCORE', PAD, PAD + 12); ctx.fillRect(PAD, PAD + 17, 22, 3)
      ctx.fillStyle = '#fff'; ctx.font = '800 26px system-ui, sans-serif'
      ctx.fillText(String(score), PAD, PAD + 48)
      ctx.fillStyle = '#8a93ad'; ctx.font = '600 12px system-ui, sans-serif'; ctx.textAlign = 'right'
      ctx.fillText('BEST  ' + best, W - PAD, PAD + 14)
      ctx.fillStyle = '#8a93ad'; ctx.fillText('JOIN THE NUMBERS → 2048', W - PAD, PAD + 34)

      // board bg
      ctx.fillStyle = '#15151c'; roundRect(BOARD_X, BOARD_Y, BOARD, BOARD, 12); ctx.fill()

      // empty slots + tiles
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
        const [x, y] = cellXY(r, c)
        ctx.fillStyle = 'rgba(255,255,255,0.04)'; roundRect(x, y, CELL, CELL, 8); ctx.fill()
        const v = board[r][c]
        if (!v) continue
        const [bg, fg] = tileColors(v)
        const s = popScale(r, c, now)
        const sw = CELL * s, sh = CELL * s, ox = x + (CELL - sw) / 2, oy = y + (CELL - sh) / 2
        ctx.fillStyle = bg; roundRect(ox, oy, sw, sh, 8); ctx.fill()
        ctx.fillStyle = fg
        const digits = String(v).length
        ctx.font = `800 ${digits <= 2 ? 40 : digits === 3 ? 32 : 26}px system-ui, sans-serif`
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillText(String(v), x + CELL / 2, y + CELL / 2 + 2)
        ctx.textBaseline = 'alphabetic'
      }

      // frame
      ctx.strokeStyle = PINK; ctx.lineWidth = 2; roundRect(BOARD_X - 1, BOARD_Y - 1, BOARD + 2, BOARD + 2, 13); ctx.stroke()

      if (state === 'won') overlay('2048!', 'space to keep going · R to restart')
      else if (state === 'over') overlay('GAME OVER', 'tap / space to play again')

      // prune finished pops
      if (pops.length) pops = pops.filter((p) => now - p.t < 140)
    }

    function overlay(title, sub) {
      ctx.fillStyle = 'rgba(10,10,10,0.82)'; roundRect(BOARD_X, BOARD_Y, BOARD, BOARD, 12); ctx.fill()
      ctx.textAlign = 'center'
      ctx.fillStyle = PINK; ctx.font = '800 44px system-ui, sans-serif'
      ctx.fillText(title, BOARD_X + BOARD / 2, BOARD_Y + BOARD / 2 - 6)
      ctx.fillStyle = PINK; ctx.fillRect(BOARD_X + BOARD / 2 - 60, BOARD_Y + BOARD / 2 + 8, 120, 4)
      ctx.fillStyle = '#fff'; ctx.font = '600 14px system-ui, sans-serif'
      ctx.fillText(sub, BOARD_X + BOARD / 2, BOARD_Y + BOARD / 2 + 38)
    }

    function loop(now) { draw(now); raf = requestAnimationFrame(loop) }

    // ---------- autoplay bot ----------
    // Does a move in `dir` change the board? (no mutation)
    function wouldChange(dir) {
      for (let i = 0; i < N; i++) {
        const line = []
        for (let j = 0; j < N; j++) { const [r, c] = coords(dir, i, j); line.push(board[r][c]) }
        const { line: merged } = slideLeft(line)
        for (let j = 0; j < N; j++) {
          const [r, c] = coords(dir, i, j)
          if (board[r][c] !== merged[j]) return true
        }
      }
      return false
    }

    let botTimer = 0
    let wantWin = true

    function maxTile() {
      let m = 0
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (board[r][c] > m) m = board[r][c]
      return m
    }

    // ----- lookahead helpers (operate on plain grids, no mutation of game state) -----
    function gridSlideLeft(line) {
      const arr = line.filter((v) => v !== 0)
      const out = []
      let i = 0
      while (i < arr.length) {
        if (i + 1 < arr.length && arr[i] === arr[i + 1]) { out.push(arr[i] * 2); i += 2 }
        else { out.push(arr[i]); i++ }
      }
      while (out.length < N) out.push(0)
      return out
    }
    function gridMove(g, dir) {
      const out = g.map((row) => row.slice())
      let changed = false
      for (let i = 0; i < N; i++) {
        const line = []
        for (let j = 0; j < N; j++) { const [r, c] = coords(dir, i, j); line.push(g[r][c]) }
        const merged = gridSlideLeft(line)
        for (let j = 0; j < N; j++) {
          const [r, c] = coords(dir, i, j)
          if (out[r][c] !== merged[j]) changed = true
          out[r][c] = merged[j]
        }
      }
      return { grid: out, changed }
    }
    function gridEmpty(g) {
      let n = 0
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (g[r][c] === 0) n++
      return n
    }
    // heuristic: keep big tiles in bottom-left corner, smooth & monotone, lots of empties
    function gridScore(g) {
      let empties = 0, mono = 0, corner = 0, smooth = 0, mx = 0
      // weight matrix anchoring the max toward bottom-left
      const W_MAT = [
        [0, 1, 2, 3],
        [1, 2, 3, 4],
        [2, 3, 4, 5],
        [6, 7, 8, 15],
      ]
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
        const v = g[r][c]
        if (v === 0) { empties++; continue }
        if (v > mx) mx = v
        corner += v * W_MAT[r][c]
        // smoothness vs right & down neighbours (penalise differences)
        if (c + 1 < N && g[r][c + 1]) smooth -= Math.abs(Math.log2(v) - Math.log2(g[r][c + 1]))
        if (r + 1 < N && g[r + 1][c]) smooth -= Math.abs(Math.log2(v) - Math.log2(g[r + 1][c]))
      }
      // monotone rows/cols increasing toward bottom-left
      for (let r = 0; r < N; r++) for (let c = 0; c + 1 < N; c++) {
        if (g[r][c] >= g[r][c + 1]) mono += 1
      }
      for (let c = 0; c < N; c++) for (let r = 0; r + 1 < N; r++) {
        if (g[r + 1][c] >= g[r][c]) mono += 1
      }
      return corner + empties * 270 + mono * 60 + smooth * 12
    }
    // expectimax-lite: try our move, then average over a couple of random spawns, 1 reply ply
    function evalAfterMove(g) {
      const empties = []
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (g[r][c] === 0) empties.push([r, c])
      if (!empties.length) return gridScore(g)
      // sample up to 3 empty cells to keep it light & smooth
      const sample = empties.length <= 3 ? empties
        : [empties[0], empties[(empties.length / 2) | 0], empties[empties.length - 1]]
      let total = 0
      for (const [r, c] of sample) {
        g[r][c] = 2
        let best = -Infinity
        for (const d of ['D', 'L', 'R', 'U']) {
          const { grid, changed } = gridMove(g, d)
          if (!changed) continue
          const s = gridScore(grid)
          if (s > best) best = s
        }
        if (best === -Infinity) best = gridScore(g)
        total += best
        g[r][c] = 0
      }
      return total / sample.length
    }

    function botMoveWin() {
      // corner ordering with lookahead tie-breaking; only play moves that change the board
      const order = ['D', 'L', 'R', 'U'] // Up only when forced (it's last)
      let bestDir = null, bestScore = -Infinity
      for (const d of order) {
        if (!wouldChange(d)) continue
        const { grid } = gridMove(board.map((row) => row.slice()), d)
        const s = evalAfterMove(grid)
        if (s > bestScore) { bestScore = s; bestDir = d }
      }
      if (bestDir) move(bestDir)
    }

    function botMoveLose() {
      // random valid moves → dead-ends quickly with a low max tile
      const valid = ['U', 'D', 'L', 'R'].filter(wouldChange)
      if (valid.length) move(valid[Math.floor(Math.random() * valid.length)])
    }

    let recorded = false

    function botMove() { if (wantWin) botMoveWin(); else botMoveLose() }

    function startRound() {
      wantWin = shouldAutoWin('2048')
      recorded = false
      reset()
    }

    function botTick() {
      if (state === 'over') {
        if (!recorded) { recordAutoplayResult('2048', maxTile() >= 512); recorded = true }
        botTimer = setTimeout(() => { startRound(); botTick() }, 1300)
        return
      }
      if (state === 'won') {
        // win session already counts (>=2048 >= 512); keep going for the visual, then it ends naturally
        wonAck = true; state = 'playing'
      }
      botMove()
      botTimer = setTimeout(botTick, 160 + Math.floor(Math.random() * 60))
    }

    if (auto) wantWin = shouldAutoWin('2048')
    reset()
    raf = requestAnimationFrame(loop)
    if (auto) botTick()

    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(botTimer)
      window.removeEventListener('keydown', onKey)
      canvas.removeEventListener('pointerdown', onPointer)
    }
  }, [])

  return (
    <canvas ref={canvasRef} width={W} height={H} className="g2048-canvas" aria-label="2048 game" />
  )
}
