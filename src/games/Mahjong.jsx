import { useEffect, useRef } from 'react'
import { isAutoplay, shouldAutoWin, recordAutoplayResult } from '../autoplay.js'

// Mahjong solitaire (tile matching) on canvas, 10x neon style.
// Layered turtle-ish layout. A tile is FREE if nothing sits on top of it AND
// its left OR right long side is open. Match two free tiles of the same face to
// remove the pair. Clear all tiles to win. Layout is generated solvable by
// reverse-removal (pairs are laid down onto free slots in removal order).
// Best = fastest clear time (ms), persisted to localStorage.

const W = 720
const H = 560

const PINK = '#ff2d6f'
const CYAN = '#2de2e6'
const MUTED = '#8a93ad'
const HS_KEY = '10xgames.mahjong.best'

// Tile footprint in canvas px. Grid coords are in HALF-tile units (so tiles can
// half-overlap their neighbours like a classic board). A tile at grid (gx,gy)
// occupies columns gx..gx+1 and rows gy..gy+1 (each spanning 2 half-units).
const TW = 46 // tile width px
const TH = 60 // tile height px
const HX = TW / 2 // half-cell x
const HY = TH / 2 // half-cell y
const LAYER_DX = 6 // pseudo-3D per-layer offset
const LAYER_DY = 7

// ---- Layout: classic "turtle" silhouette, defined as half-unit (gx,gy) per layer.
// Coordinates are columns 0..28 (half-units) wide. Rows 0..15. Built to be a
// recognisable board (~72 tiles = 36 pairs). Each entry: [gx, gy].
const LAYOUT = (() => {
  const layers = []
  // Layer 0 — wide turtle base, 6 rows. Each row's tile count is EVEN and the
  // rows narrow toward the top/bottom for a shell-like silhouette. gx are in
  // half-units (step 2 per tile); centred around column 14.
  const L0 = []
  const rowSpec = [
    // [gy, gxStart, count]
    [0, 8, 8],   // 8 tiles
    [2, 4, 12],  // 12
    [4, 2, 14],  // 14
    [6, 2, 14],  // 14
    [8, 4, 12],  // 12
    [10, 8, 8],  // 8
  ]
  for (const [gy, gx0, count] of rowSpec) {
    for (let i = 0; i < count; i++) L0.push([gx0 + i * 2, gy])
  }
  layers.push(L0) // 68 tiles
  // Layer 1 — centred 4x... block sitting on the base middle.
  const L1 = []
  const l1Rows = [[2, 8, 8], [4, 6, 10], [6, 6, 10], [8, 8, 8]]
  for (const [gy, gx0, count] of l1Rows) for (let i = 0; i < count; i++) L1.push([gx0 + i * 2, gy])
  layers.push(L1) // 36 tiles
  // Layer 2 — smaller centred block.
  const L2 = []
  const l2Rows = [[4, 10, 4], [6, 10, 4]]
  for (const [gy, gx0, count] of l2Rows) for (let i = 0; i < count; i++) L2.push([gx0 + i * 2, gy])
  layers.push(L2) // 8 tiles
  // Layer 3 — 2-tile cap, centred.
  layers.push([[12, 5], [14, 5]]) // 2 tiles

  const out = []
  for (let layer = 0; layer < layers.length; layer++) {
    for (const [gx, gy] of layers[layer]) out.push({ gx, gy, layer })
  }
  return out
})()

// Centre the board horizontally/vertically based on grid extent.
const GRID = (() => {
  let maxGx = 0, maxGy = 0
  for (const t of LAYOUT) { maxGx = Math.max(maxGx, t.gx); maxGy = Math.max(maxGy, t.gy) }
  // grid span in px: each +2 half-units = one tile width; tile spans +2 too.
  const spanX = (maxGx + 2) * HX
  const spanY = (maxGy + 2) * HY
  const offX = Math.round((W - spanX) / 2)
  const offY = Math.round((H - spanY) / 2) + 10
  return { offX, offY }
})()

// Tile faces: original simple suits drawn as shapes.
//  - 'dot' 1..9   : circles arrangement
//  - 'bam' 1..9   : bamboo sticks
//  - 'chr' 1..9   : roman-ish numerals (drawn glyphs)
//  - 'wind' E/S/W/N, 'dragon' R/G/W : honor tiles (icons)
//  - 'flower' 1..4, 'season' 1..4 : bonus groups (match within group)
// 72 tiles = 36 pairs. We build a pair pool then assign by solvable placement.
function buildFacePool(nPairs) {
  const faces = []
  // suited tiles: 3 suits x 9 ranks = 27 distinct
  for (const suit of ['dot', 'bam', 'chr']) for (let r = 1; r <= 9; r++) faces.push(`${suit}${r}`)
  // winds + dragons = 7 distinct
  for (const w of ['windE', 'windS', 'windW', 'windN']) faces.push(w)
  for (const d of ['dragR', 'dragG', 'dragW']) faces.push(d)
  // bonus groups: any flower matches any flower, any season matches any season.
  // We model these as group keys 'FLOWER' / 'SEASON'.
  const pool = []
  // First, pick distinct faces for most pairs, recycling as needed.
  let fi = 0
  for (let p = 0; p < nPairs - 2; p++) {
    pool.push(faces[fi % faces.length])
    fi++
  }
  pool.push('FLOWER')
  pool.push('SEASON')
  return pool // length nPairs, each a "match key" used twice
}

export default function Mahjong() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const auto = isAutoplay('mahjong')

    let tiles = []          // {id, gx, gy, layer, face, removed}
    let solution = []       // [idA, idB] removal order that clears the board
    let selected = -1       // tile id of first selected, or -1
    let state = 'playing'   // playing | won | stuck
    let startTime = 0
    let endTime = 0
    let movesHint = 0       // count of available matching free pairs
    let best = Number(localStorage.getItem(HS_KEY)) || 0
    let raf = 0

    // ---------- geometry helpers ----------
    function tileX(t) { return GRID.offX + t.gx * HX + t.layer * LAYER_DX }
    function tileY(t) { return GRID.offY + t.gy * HY - t.layer * LAYER_DY }

    // Two tiles overlap in footprint if their 2x2 half-unit cells intersect.
    function overlap(a, b) {
      return Math.abs(a.gx - b.gx) < 2 && Math.abs(a.gy - b.gy) < 2
    }

    // A tile is covered if any non-removed tile on the layer directly above
    // overlaps its footprint.
    function isCovered(t, arr) {
      for (const o of arr) {
        if (o.removed || o === t) continue
        if (o.layer === t.layer + 1 && overlap(t, o)) return true
      }
      return false
    }

    // Left side blocked if a non-removed same-layer tile sits immediately left
    // (its right edge touches our left edge) and vertically overlaps.
    function sideBlocked(t, arr, dir) {
      for (const o of arr) {
        if (o.removed || o === t) continue
        if (o.layer !== t.layer) continue
        if (Math.abs(o.gy - t.gy) >= 2) continue // not vertically adjacent
        if (dir < 0 && o.gx === t.gx - 2) return true
        if (dir > 0 && o.gx === t.gx + 2) return true
      }
      return false
    }

    function isFree(t, arr) {
      if (t.removed) return false
      if (isCovered(t, arr)) return false
      const leftOpen = !sideBlocked(t, arr, -1)
      const rightOpen = !sideBlocked(t, arr, +1)
      return leftOpen || rightOpen
    }

    function freeTiles(arr) {
      const out = []
      for (const t of arr) if (isFree(t, arr)) out.push(t)
      return out
    }

    // Two faces match: identical key, OR both in same bonus group.
    function facesMatch(a, b) {
      if (a === b) return true
      return false // FLOWER/SEASON already collapse to one key each, so equality suffices
    }

    // ---------- solvable generation (reverse removal) ----------
    // Place faces onto positions so that a greedy free-pair removal can clear it.
    // Strategy: simulate by treating all slots present, repeatedly pick a pair of
    // currently-free slots, assign them a face from the pool, and "remove" them.
    function generate() {
      // Fresh slot objects with no faces.
      const slots = LAYOUT.map((p, i) => ({ id: i, gx: p.gx, gy: p.gy, layer: p.layer, face: null, removed: false }))
      const nPairs = slots.length / 2
      const pool = shuffle(buildFacePool(nPairs))

      // Reverse build: all slots start "present" (face unknown). We assign faces
      // by repeatedly removing a free pair (in the layout) and giving that pair
      // the next pool face. Removing free pairs in this order guarantees the
      // forward game can be solved by removing them in reverse.
      const present = slots.map(() => true)
      const live = () => slots.filter((s) => present[s.id])

      function freeSlots() {
        const arr = live()
        const out = []
        for (const s of arr) {
          // covered?
          let covered = false
          for (const o of arr) {
            if (o === s) continue
            if (o.layer === s.layer + 1 && Math.abs(o.gx - s.gx) < 2 && Math.abs(o.gy - s.gy) < 2) { covered = true; break }
          }
          if (covered) continue
          let lb = false, rb = false
          for (const o of arr) {
            if (o === s || o.layer !== s.layer) continue
            if (Math.abs(o.gy - s.gy) >= 2) continue
            if (o.gx === s.gx - 2) lb = true
            if (o.gx === s.gx + 2) rb = true
          }
          if (!lb || !rb) out.push(s)
        }
        return out
      }

      let pi = 0
      let ok = true
      const genOrder = [] // [idA, idB] pairs in generation (removal) order
      while (live().length > 0) {
        const free = freeSlots()
        if (free.length < 2) { ok = false; break }
        // pick two distinct free slots at random
        const a = free[Math.floor(Math.random() * free.length)]
        let b = a
        while (b === a) b = free[Math.floor(Math.random() * free.length)]
        const face = pool[pi++]
        a.face = face
        b.face = face
        present[a.id] = false
        present[b.id] = false
        genOrder.push([a.id, b.id])
      }
      if (!ok) return null
      // sanity: every slot got a face
      for (const s of slots) if (s.face == null) return null
      // Forward solution = the generation order itself. Pair k was free in
      // generation given pairs 0..k-1 still present; in the forward game pairs
      // 0..k-1 are exactly the ones already removed, so pair k is free in turn.
      const solution = genOrder.slice()
      const board = slots.map((s) => ({ id: s.id, gx: s.gx, gy: s.gy, layer: s.layer, face: s.face, removed: false }))
      return { board, solution }
    }

    // Greedy solver: returns true if a simple greedy strategy can clear `arr`.
    // Used to double-verify a generated board is solvable.
    function greedySolvable(arr) {
      const work = arr.map((t) => ({ ...t }))
      let remaining = work.length
      let guard = work.length * 4
      while (remaining > 0 && guard-- > 0) {
        const free = freeTiles(work)
        // group free tiles by face
        const byFace = new Map()
        for (const t of free) {
          if (!byFace.has(t.face)) byFace.set(t.face, [])
          byFace.get(t.face).push(t)
        }
        let removedAny = false
        for (const [, group] of byFace) {
          if (group.length >= 2) {
            group[0].removed = true
            group[1].removed = true
            remaining -= 2
            removedAny = true
            break
          }
        }
        if (!removedAny) return remaining === 0
      }
      return remaining === 0
    }

    function newBoard() {
      let g = null
      for (let attempt = 0; attempt < 80; attempt++) {
        const cand = generate()
        // generate() already guarantees solvability via reverse-removal; the
        // greedy check is a redundant double-verification.
        if (cand && greedySolvable(cand.board)) { g = cand; break }
      }
      if (!g) {
        // Extremely unlikely fallback: accept any generated board.
        for (let attempt = 0; attempt < 80 && !g; attempt++) g = generate()
      }
      tiles = g ? g.board : []
      solution = g ? g.solution : []
      selected = -1
      state = 'playing'
      startTime = performance.now()
      endTime = 0
      recountHint()
    }

    function recountHint() {
      const free = freeTiles(tiles)
      const byFace = new Map()
      for (const t of free) {
        if (!byFace.has(t.face)) byFace.set(t.face, 0)
        byFace.set(t.face, byFace.get(t.face) + 1)
      }
      let pairs = 0
      for (const [, n] of byFace) pairs += Math.floor(n / 2)
      movesHint = pairs
    }

    function remainingCount() {
      let n = 0
      for (const t of tiles) if (!t.removed) n++
      return n
    }

    // Reshuffle remaining tiles' faces in place (keeps positions, solvable-ish:
    // we re-run greedy verification and retry a few times).
    function shuffleRemaining() {
      const live = tiles.filter((t) => !t.removed)
      if (live.length < 2) return
      solution = [] // reshuffling invalidates the recorded solution
      for (let attempt = 0; attempt < 40; attempt++) {
        const faces = live.map((t) => t.face)
        const sh = shuffle(faces.slice())
        const test = tiles.map((t) => ({ ...t }))
        const liveTest = test.filter((t) => !t.removed)
        for (let i = 0; i < liveTest.length; i++) liveTest[i].face = sh[i]
        if (greedySolvable(test)) {
          for (let i = 0; i < live.length; i++) live[i].face = sh[i]
          selected = -1
          state = 'playing'
          recountHint()
          return
        }
      }
      // give up gracefully: at least assign the shuffle
      const sh = shuffle(live.map((t) => t.face))
      for (let i = 0; i < live.length; i++) live[i].face = sh[i]
      selected = -1
      state = 'playing'
      recountHint()
    }

    function tryRemovePair(idA, idB) {
      const a = tiles[idA], b = tiles[idB]
      if (!a || !b || a.removed || b.removed) return false
      if (!isFree(a, tiles) || !isFree(b, tiles)) return false
      if (!facesMatch(a.face, b.face)) return false
      a.removed = true
      b.removed = true
      return true
    }

    function afterRemoval() {
      recountHint()
      if (tiles.length > 0 && remainingCount() === 0) {
        state = 'won'
        endTime = performance.now()
        const ms = Math.round(endTime - startTime)
        if (best === 0 || ms < best) {
          best = ms
          localStorage.setItem(HS_KEY, String(best))
        }
      } else if (movesHint === 0) {
        state = 'stuck'
      }
    }

    function clickTile(id) {
      if (state !== 'playing') return
      const t = tiles[id]
      if (!t || t.removed || !isFree(t, tiles)) return
      if (selected === -1) { selected = id; return }
      if (selected === id) { selected = -1; return } // deselect
      if (tryRemovePair(selected, id)) {
        selected = -1
        afterRemoval()
      } else {
        // not a match: switch selection to the new tile
        selected = id
      }
    }

    // Hit-test in topmost-first order (higher layers drawn last/on top).
    function tileAt(px, py) {
      const order = tiles
        .map((t, i) => ({ t, i }))
        .filter((o) => !o.t.removed)
        .sort((a, b) => (a.t.layer - b.t.layer) || (a.t.gy - b.t.gy) || (a.t.gx - b.t.gx))
      for (let k = order.length - 1; k >= 0; k--) {
        const { t, i } = order[k]
        const x = tileX(t), y = tileY(t)
        if (px >= x && px <= x + TW && py >= y && py <= y + TH) return i
      }
      return -1
    }

    // ---------- input ----------
    function buttonRects() {
      const y = H - 30
      return {
        newBtn: { x: W - 230, y: y - 16, w: 100, h: 28 },
        shuffleBtn: { x: W - 120, y: y - 16, w: 100, h: 28 },
      }
    }
    function inRect(px, py, r) { return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h }

    function onPointer(e) {
      e.preventDefault()
      if (auto) return
      const rect = canvas.getBoundingClientRect()
      const px = (e.clientX - rect.left) * (W / rect.width)
      const py = (e.clientY - rect.top) * (H / rect.height)
      const { newBtn, shuffleBtn } = buttonRects()
      if (inRect(px, py, newBtn)) { newBoard(); return }
      if (inRect(px, py, shuffleBtn)) {
        if (state === 'won') { newBoard(); return }
        shuffleRemaining()
        return
      }
      if (state === 'won' || state === 'stuck') {
        if (state === 'stuck') shuffleRemaining()
        else newBoard()
        return
      }
      const id = tileAt(px, py)
      if (id >= 0) clickTile(id)
    }
    function onKey(e) {
      if (auto) return
      if (e.code === 'KeyN') { e.preventDefault(); newBoard() }
      else if (e.code === 'KeyS') { e.preventDefault(); if (state !== 'won') shuffleRemaining() }
      else if (e.code === 'Space') { e.preventDefault(); if (state === 'won') newBoard(); else if (state === 'stuck') shuffleRemaining() }
    }
    canvas.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)

    // ---------- drawing ----------
    function roundRect(x, y, w, h, r) {
      r = Math.min(r, w / 2, h / 2)
      ctx.beginPath()
      ctx.moveTo(x + r, y)
      ctx.arcTo(x + w, y, x + w, y + h, r)
      ctx.arcTo(x + w, y + h, x, y + h, r)
      ctx.arcTo(x, y + h, x, y, r)
      ctx.arcTo(x, y, x + w, y, r)
      ctx.closePath()
    }
    function sparkle(x, y, s) {
      ctx.strokeStyle = PINK; ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(x - s, y); ctx.lineTo(x + s, y)
      ctx.moveTo(x, y - s); ctx.lineTo(x, y + s)
      ctx.stroke()
    }

    // ---- symbol drawing (original shapes, no copyrighted art) ----
    function suitColor(face) {
      if (face.startsWith('dot')) return CYAN
      if (face.startsWith('bam')) return '#54e346'
      if (face.startsWith('chr')) return PINK
      if (face.startsWith('wind')) return '#4d7cff'
      if (face.startsWith('drag')) return '#ffd60a'
      if (face === 'FLOWER') return '#ff8a1e'
      if (face === 'SEASON') return '#b14aed'
      return '#fff'
    }

    function drawSymbol(face, cx, cy, dim) {
      const col = suitColor(face)
      ctx.save()
      ctx.globalAlpha = dim ? 0.55 : 1
      ctx.strokeStyle = col
      ctx.fillStyle = col
      ctx.lineWidth = 2
      const rank = Number(face.replace(/\D/g, '')) || 0

      if (face.startsWith('dot')) {
        // dots: small circles in a grid based on rank
        drawDots(rank, cx, cy, col)
      } else if (face.startsWith('bam')) {
        drawBamboo(rank, cx, cy, col)
      } else if (face.startsWith('chr')) {
        // characters: stylised numeral glyph
        ctx.fillStyle = col
        ctx.font = '800 22px system-ui, sans-serif'
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillText(String(rank), cx, cy - 6)
        ctx.font = '700 10px system-ui, sans-serif'
        ctx.fillText('万', cx, cy + 11)
      } else if (face.startsWith('wind')) {
        const ch = face.slice(4) // E/S/W/N
        ctx.fillStyle = col
        ctx.font = '800 20px system-ui, sans-serif'
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillText(ch, cx, cy)
        drawCompass(cx, cy, col)
      } else if (face.startsWith('drag')) {
        const d = face.slice(4) // R/G/W
        drawDragon(d, cx, cy, col)
      } else if (face === 'FLOWER') {
        drawFlower(cx, cy, col)
      } else if (face === 'SEASON') {
        drawSeason(cx, cy, col)
      }
      ctx.restore()
    }

    function circle(x, y, r, col, fill) {
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      if (fill) { ctx.fillStyle = col; ctx.fill() } else { ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke() }
    }

    function drawDots(rank, cx, cy, col) {
      const positions = dotLayout(rank)
      const r = 3.4
      for (const [dx, dy] of positions) {
        circle(cx + dx * 8, cy + dy * 8, r, col, true)
        circle(cx + dx * 8, cy + dy * 8, r + 1.6, col, false)
      }
    }
    function dotLayout(n) {
      // returns array of [col,row] offsets centred at 0
      switch (n) {
        case 1: return [[0, 0]]
        case 2: return [[0, -1], [0, 1]]
        case 3: return [[-1, -1], [0, 0], [1, 1]]
        case 4: return [[-1, -1], [1, -1], [-1, 1], [1, 1]]
        case 5: return [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]]
        case 6: return [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]]
        case 7: return [[-1, -1.2], [1, -1.2], [-1, 0], [1, 0], [0, -0.6], [-1, 1.2], [1, 1.2]]
        case 8: return [[-1, -1], [1, -1], [-1, -0.2], [1, -0.2], [-1, 0.7], [1, 0.7], [-1, 1.4], [1, 1.4]]
        case 9: return [[-1, -1], [0, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]
        default: return [[0, 0]]
      }
    }
    function drawBamboo(rank, cx, cy, col) {
      // vertical sticks; arrange in rows
      const cols = rank <= 3 ? rank : rank <= 6 ? 3 : 3
      const stickH = 10, stickW = 4
      const layoutN = []
      // simple: top row count, bottom row count
      let arrangement
      if (rank === 1) arrangement = [[0, 0]]
      else if (rank <= 4) arrangement = rowsOf(rank, 1)
      else if (rank <= 6) arrangement = rowsOf(rank, 2)
      else arrangement = rowsOf(rank, 3)
      for (const [gx, gy] of arrangement) {
        const x = cx + gx * 7
        const y = cy + gy * 11
        ctx.fillStyle = col
        roundRect(x - stickW / 2, y - stickH / 2, stickW, stickH, 2); ctx.fill()
        ctx.strokeStyle = '#0a0a0a'; ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(x - stickW / 2, y); ctx.lineTo(x + stickW / 2, y); ctx.stroke()
      }
    }
    function rowsOf(n, rows) {
      const per = Math.ceil(n / rows)
      const out = []
      let placed = 0
      for (let r = 0; r < rows; r++) {
        const thisRow = Math.min(per, n - placed)
        const startX = -(thisRow - 1) / 2
        const y = rows === 1 ? 0 : (r - (rows - 1) / 2)
        for (let i = 0; i < thisRow; i++) out.push([startX + i, y])
        placed += thisRow
      }
      return out
    }
    function drawCompass(cx, cy, col) {
      ctx.strokeStyle = col; ctx.lineWidth = 1.4; ctx.globalAlpha *= 0.7
      circle(cx, cy + 10, 8, col, false)
      ctx.globalAlpha /= 0.7
    }
    function drawDragon(d, cx, cy, col) {
      if (d === 'R') {
        ctx.fillStyle = col; ctx.font = '800 18px system-ui, sans-serif'
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillText('中', cx, cy)
      } else if (d === 'G') {
        ctx.fillStyle = col; ctx.font = '800 18px system-ui, sans-serif'
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillText('發', cx, cy)
      } else {
        // white dragon: hollow rounded frame
        ctx.strokeStyle = col; ctx.lineWidth = 2.4
        roundRect(cx - 9, cy - 12, 18, 24, 4); ctx.stroke()
      }
    }
    function drawFlower(cx, cy, col) {
      ctx.fillStyle = col
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2
        circle(cx + Math.cos(a) * 7, cy + Math.sin(a) * 7, 4, col, true)
      }
      circle(cx, cy, 3.5, '#0a0a0a', true)
      circle(cx, cy, 3, col, true)
    }
    function drawSeason(cx, cy, col) {
      // four-point star / leaf
      ctx.fillStyle = col
      ctx.beginPath()
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 - Math.PI / 2
        const r = i % 2 === 0 ? 11 : 4.5
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
      }
      ctx.closePath(); ctx.fill()
    }

    function drawTile(t, now) {
      const x = tileX(t), y = tileY(t)
      const free = isFree(t, tiles)
      const isSel = t.id === selected
      // pseudo-3D right/bottom side
      ctx.fillStyle = '#0d2027'
      roundRect(x + LAYER_DX - 2, y + 4, TW, TH, 8); ctx.fill()
      // face base
      ctx.fillStyle = free ? '#1a2a33' : '#13191e'
      roundRect(x, y, TW, TH, 8); ctx.fill()

      // neon edge
      if (isSel) {
        const pulse = 0.5 + 0.5 * Math.sin(now / 180)
        ctx.shadowColor = CYAN; ctx.shadowBlur = 16 + pulse * 12
        ctx.strokeStyle = CYAN; ctx.lineWidth = 3
        roundRect(x + 1.5, y + 1.5, TW - 3, TH - 3, 7); ctx.stroke()
        ctx.shadowColor = PINK; ctx.shadowBlur = 10 + pulse * 10
        ctx.strokeStyle = PINK; ctx.lineWidth = 2
        roundRect(x + 1.5, y + 1.5, TW - 3, TH - 3, 7); ctx.stroke()
        ctx.shadowBlur = 0
      } else if (free) {
        ctx.shadowColor = 'rgba(45,226,230,0.6)'; ctx.shadowBlur = 8
        ctx.strokeStyle = 'rgba(45,226,230,0.75)'; ctx.lineWidth = 1.6
        roundRect(x + 1, y + 1, TW - 2, TH - 2, 7); ctx.stroke()
        ctx.shadowBlur = 0
      } else {
        ctx.strokeStyle = 'rgba(138,147,173,0.35)'; ctx.lineWidth = 1.4
        roundRect(x + 1, y + 1, TW - 2, TH - 2, 7); ctx.stroke()
      }

      drawSymbol(t.face, x + TW / 2, y + TH / 2, !free)
    }

    function drawButton(r, label, on) {
      ctx.fillStyle = on ? 'rgba(255,45,111,0.18)' : 'rgba(255,255,255,0.05)'
      roundRect(r.x, r.y, r.w, r.h, 7); ctx.fill()
      ctx.strokeStyle = on ? PINK : 'rgba(138,147,173,0.4)'; ctx.lineWidth = 1.5
      roundRect(r.x, r.y, r.w, r.h, 7); ctx.stroke()
      ctx.fillStyle = on ? PINK : MUTED
      ctx.font = '800 12px system-ui, sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2)
      ctx.textBaseline = 'alphabetic'
    }

    function fmtTime(ms) {
      const s = Math.floor(ms / 1000)
      const m = Math.floor(s / 60)
      return `${m}:${String(s % 60).padStart(2, '0')}`
    }

    function overlay(title, sub) {
      ctx.fillStyle = 'rgba(10,10,10,0.82)'
      ctx.fillRect(0, 0, W, H)
      ctx.textAlign = 'center'
      ctx.fillStyle = PINK; ctx.font = '800 36px system-ui, sans-serif'
      ctx.fillText(title, W / 2, H / 2 - 8)
      ctx.fillStyle = PINK
      ctx.fillRect(W / 2 - 80, H / 2 + 12, 160, 4)
      ctx.fillStyle = '#fff'; ctx.font = '600 15px system-ui, sans-serif'
      ctx.fillText(sub, W / 2, H / 2 + 42)
    }

    function draw(now) {
      ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, W, H)
      // faint grid background (40px @ 2% opacity)
      ctx.strokeStyle = 'rgba(255,255,255,0.02)'; ctx.lineWidth = 1
      for (let gx = 0; gx <= W; gx += 40) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke() }
      for (let gy = 0; gy <= H; gy += 40) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke() }
      sparkle(W - 16, 16, 5); sparkle(16, H - 16, 4)

      // header labels
      ctx.fillStyle = PINK; ctx.font = '700 12px system-ui, sans-serif'; ctx.textAlign = 'left'
      ctx.fillText('TILES', 20, 22); ctx.fillRect(20, 27, 22, 3)
      ctx.fillStyle = '#fff'; ctx.font = '800 24px system-ui, sans-serif'
      ctx.fillText(String(remainingCount()), 20, 50)

      ctx.fillStyle = PINK; ctx.font = '700 12px system-ui, sans-serif'; ctx.textAlign = 'left'
      ctx.fillText('MOVES', 110, 22); ctx.fillRect(110, 27, 22, 3)
      ctx.fillStyle = movesHint > 0 ? CYAN : '#fff'; ctx.font = '800 24px system-ui, sans-serif'
      ctx.fillText(String(movesHint), 110, 50)

      ctx.fillStyle = PINK; ctx.font = '700 12px system-ui, sans-serif'; ctx.textAlign = 'left'
      ctx.fillText('TIME', 210, 22); ctx.fillRect(210, 27, 22, 3)
      ctx.fillStyle = '#fff'; ctx.font = '800 24px system-ui, sans-serif'
      const elapsed = state === 'playing' ? now - startTime : (endTime ? endTime - startTime : 0)
      ctx.fillText(fmtTime(elapsed), 210, 50)

      ctx.fillStyle = PINK; ctx.font = '700 12px system-ui, sans-serif'; ctx.textAlign = 'right'
      ctx.fillText('BEST', W - 20, 22); ctx.fillRect(W - 42, 27, 22, 3)
      ctx.fillStyle = '#fff'; ctx.font = '800 24px system-ui, sans-serif'
      ctx.fillText(best ? fmtTime(best) : '—', W - 20, 50)

      // tiles: draw bottom layers first so higher layers overlap correctly
      const order = tiles
        .filter((t) => !t.removed)
        .slice()
        .sort((a, b) => (a.layer - b.layer) || (a.gy - b.gy) || (a.gx - b.gx))
      for (const t of order) drawTile(t, now)

      // buttons
      const { newBtn, shuffleBtn } = buttonRects()
      drawButton(newBtn, 'NEW', false)
      drawButton(shuffleBtn, 'SHUFFLE', state === 'stuck')

      if (state === 'won') overlay('CLEARED — ' + fmtTime(endTime - startTime), 'click NEW or press space')
      else if (state === 'stuck') overlay('NO MOVES', 'click SHUFFLE to continue')
    }

    function loop(now) { draw(now); raf = requestAnimationFrame(loop) }

    // ---------- autoplay bot ----------
    // Win rounds replay the recorded `solution` (the reverse-removal order that
    // is guaranteed to clear the board) -> ~100% clear capability, so the 95%
    // self-corrector can actually hold its target. ~5% lose rounds make a
    // deliberately bad early match that strands tiles (board goes stuck).
    let botTimer = 0
    let wantWin = shouldAutoWin('mahjong')
    let recorded = false

    // Scored greedy: prefer the move that keeps the most future matching options
    // (used as a fallback if the recorded solution is unavailable, e.g. after a
    // human shuffle invalidated it).
    function botPickGreedy() {
      const free = freeTiles(tiles)
      const byFace = new Map()
      for (const t of free) {
        if (!byFace.has(t.face)) byFace.set(t.face, [])
        byFace.get(t.face).push(t)
      }
      const candidates = []
      for (const [, g] of byFace) {
        if (g.length >= 2) {
          for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) candidates.push([g[i], g[j]])
        }
      }
      if (candidates.length === 0) return null
      function scoreAfter(a, b) {
        const sim = tiles.map((t) => ({ ...t }))
        sim.find((t) => t.id === a.id).removed = true
        sim.find((t) => t.id === b.id).removed = true
        const f2 = freeTiles(sim)
        const bf = new Map()
        for (const t of f2) bf.set(t.face, (bf.get(t.face) || 0) + 1)
        let pairs = 0
        for (const [, n] of bf) pairs += Math.floor(n / 2)
        return pairs
      }
      let best = candidates[0], bestScore = -1
      for (const [a, b] of candidates) {
        const s = scoreAfter(a, b)
        if (s > bestScore) { bestScore = s; best = [a, b] }
      }
      return best
    }

    // Pick a pair that is ACTUALLY removable right now. Prefer the recorded
    // solution order, but only accept a solution pair whose BOTH tiles are
    // currently free. If the next solution pair isn't free yet (because a removal
    // happened out of solution order), fall back to ANY currently-free matching
    // pair so progress always continues. Returns null only when no free matching
    // pair exists at all (genuinely stuck).
    function botPickSolution() {
      for (const [ia, ib] of solution) {
        const a = tiles[ia], b = tiles[ib]
        if (a && b && !a.removed && !b.removed && isFree(a, tiles) && isFree(b, tiles)) return [a, b]
      }
      // No solution pair is free right now (out-of-order removal); take any
      // currently-free matching pair so the board keeps progressing.
      return botPickGreedy()
    }

    // Worst pair (greedy minimiser) — used to deliberately strand tiles.
    function botPickWorst() {
      const free = freeTiles(tiles)
      const byFace = new Map()
      for (const t of free) {
        if (!byFace.has(t.face)) byFace.set(t.face, [])
        byFace.get(t.face).push(t)
      }
      let worst = null, worstScore = Infinity
      for (const [, g] of byFace) {
        if (g.length >= 2) {
          const sim = tiles.map((t) => ({ ...t }))
          sim.find((t) => t.id === g[0].id).removed = true
          sim.find((t) => t.id === g[1].id).removed = true
          const f2 = freeTiles(sim)
          const bf = new Map()
          for (const t of f2) bf.set(t.face, (bf.get(t.face) || 0) + 1)
          let pairs = 0
          for (const [, n] of bf) pairs += Math.floor(n / 2)
          if (pairs < worstScore) { worstScore = pairs; worst = [g[0], g[1]] }
        }
      }
      return worst
    }

    function botStep() {
      if (state === 'won' || state === 'stuck') {
        if (!recorded) {
          recorded = true
          recordAutoplayResult('mahjong', state === 'won')
          botTimer = setTimeout(() => {
            recorded = false
            wantWin = shouldAutoWin('mahjong')
            newBoard()
            scheduleBot(700)
          }, 1700)
        }
        return
      }

      let pair = null
      if (wantWin) {
        // follow the guaranteed solution, but only ever pick a pair that is free
        // right now (botPickSolution falls back to any free matching pair).
        pair = botPickSolution()
      } else {
        // lose round: always take the stranding (worst) move so the board is
        // likely to dead-end and the round records as a loss.
        pair = botPickWorst() || botPickGreedy()
      }

      if (!pair) {
        // No removable pair exists right now: the board is genuinely stuck (or
        // empty after a generation failure). End the round so it records and
        // autoplay restarts instead of spinning. Don't flag a 0-tile board as a
        // win — only a board with tiles still on it that we actually cleared.
        state = remainingCount() === 0 && tiles.length > 0 ? 'won' : 'stuck'
        if (state === 'won') {
          endTime = performance.now()
          const ms = Math.round(endTime - startTime)
          if (best === 0 || ms < best) { best = ms; localStorage.setItem(HS_KEY, String(best)) }
        }
        scheduleBot(200)
        return
      }
      const [a, b] = pair
      selected = a.id
      // brief visual select, then remove
      botTimer = setTimeout(() => {
        if (tryRemovePair(a.id, b.id)) { selected = -1; afterRemoval() }
        else selected = -1
        scheduleBot(380 + Math.floor(Math.random() * 170))
      }, 230)
    }

    function scheduleBot(ms) {
      clearTimeout(botTimer)
      botTimer = setTimeout(botStep, ms)
    }

    newBoard()
    raf = requestAnimationFrame(loop)
    if (auto) scheduleBot(800)

    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(botTimer)
      canvas.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  return (
    <canvas ref={canvasRef} width={W} height={H} className="mahjong-canvas" aria-label="Mahjong solitaire game" />
  )
}

// ---- module-scope util ----
function shuffle(arr) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
