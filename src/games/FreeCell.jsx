import { useEffect, useRef } from 'react'
import { isAutoplay, shouldAutoWin, recordAutoplayResult } from '../autoplay.js'

// FreeCell solitaire on canvas — 10x neon style — with a 95% autoplay bot.
// All state + logic live in ONE useEffect; rAF draw loop; plain `let` vars.
// Human play uses a fair shuffle. Autoplay rigs the deal on "win" rounds so a
// greedy bot completes the game; on ~5% "lose" rounds it stalls on a hard deal.
const W = 760
const H = 560
const BEST_KEY = '10xgames.freecell.best'

const BG = '#0a0a0a'
const FELT = '#0d2417'
const PINK = '#ff2d6f'
const BLUE = '#4d7cff'
const GREEN = '#54e346'
const GOLD = '#ffd60a'
const MUTED = '#8a93ad'
const CARD_FACE = '#1a1f2c'

const SUITS = ['♠', '♥', '♦', '♣'] // 0 spades, 1 hearts, 2 diamonds, 3 clubs
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
const isRed = (s) => s === 1 || s === 2

// Card: { r: 0..12 (A..K), s: 0..3 }
const mk = (r, s) => ({ r, s })

// ---------- decks ----------
function fairDeck() {
  const d = []
  for (let s = 0; s < 4; s++) for (let r = 0; r < 13; r++) d.push(mk(r, s))
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[d[i], d[j]] = [d[j], d[i]]
  }
  return d
}

// Deal 52 cards into 8 cascades (round-robin, all face up). cols 0..3 get 7
// cards, cols 4..7 get 6 cards.
function dealLayout(deck) {
  const d = deck.slice()
  const tableau = [[], [], [], [], [], [], [], []]
  for (let i = 0; i < 52; i++) tableau[i % 8].push({ ...d[i] })
  return {
    tableau,
    free: [null, null, null, null],
    foundations: [[], [], [], []], // index by suit
  }
}

// ---------- rules ----------
const foundationWants = (f, c) => (f.length === 0 ? c.r === 0 : f[f.length - 1].r === c.r - 1)

// Tableau builds DOWN, alternating colors.
function canStackTableau(dest, c) {
  if (dest.length === 0) return true
  const top = dest[dest.length - 1]
  return isRed(top.s) !== isRed(c.s) && top.r === c.r + 1
}

// Is `cards` (top-of-column slice) a valid descending alternating-color run?
function isRun(cards) {
  for (let i = 0; i < cards.length - 1; i++) {
    const a = cards[i], b = cards[i + 1]
    if (!(isRed(a.s) !== isRed(b.s) && a.r === b.r + 1)) return false
  }
  return true
}

// Max cards movable as a supermove: (freeCells+1) * 2^(emptyCols). The classic
// FreeCell formula. When moving ONTO an empty column, that column can't be used
// as an intermediary, so emptyCols is reduced by one for that case.
function maxSupermove(st, destIsEmpty) {
  const freeCells = st.free.filter((c) => c === null).length
  let emptyCols = st.tableau.filter((col) => col.length === 0).length
  if (destIsEmpty) emptyCols = Math.max(0, emptyCols - 1)
  return (freeCells + 1) * Math.pow(2, emptyCols)
}

const isWon = (st) => st.foundations.reduce((a, f) => a + f.length, 0) === 52

// ---------- greedy solver (headless; verifies autoplay deals) ----------
function cloneState(st) {
  return {
    tableau: st.tableau.map((col) => col.map((c) => ({ ...c }))),
    free: st.free.map((c) => (c ? { ...c } : null)),
    foundations: st.foundations.map((f) => f.map((c) => ({ ...c }))),
  }
}

// Lowest rank still needed across both colors of opposite suits — used to decide
// when a card is "safe" to auto-send to a foundation.
function safeToFoundation(st, c) {
  if (!foundationWants(st.foundations[c.s], c)) return false
  if (c.r <= 1) return true // aces & twos always safe
  // safe if both opposite-color foundations are at least c.r-1
  const opp = isRed(c.s) ? [0, 3] : [1, 2]
  for (const s of opp) {
    const top = st.foundations[s].length
    if (top < c.r - 1) return false
  }
  return true
}

// Canonical key of a state (column order normalized, free cells sorted) for the
// visited set so the DFS doesn't revisit equivalent positions.
function stateKey(st) {
  const cols = st.tableau.map((col) => col.map((c) => c.r * 4 + c.s).join(',')).sort()
  const free = st.free.filter((c) => c).map((c) => c.r * 4 + c.s).sort((a, b) => a - b)
  const found = st.foundations.map((f) => f.length)
  return cols.join('|') + '#' + free.join(',') + '#' + found.join(',')
}

// Apply a move object to a state (mutating). Move kinds:
//  {k:'tt', from, start, to}  tableau run -> tableau
//  {k:'tf', from}             tableau top -> foundation
//  {k:'tc', from, cell}       tableau top -> free cell
//  {k:'ft', cell, to}         free cell  -> tableau
//  {k:'ff', cell}             free cell  -> foundation
function applyMove(st, m) {
  if (m.k === 'tt') { const run = st.tableau[m.from].splice(m.start); st.tableau[m.to] = st.tableau[m.to].concat(run) }
  else if (m.k === 'tf') { const c = st.tableau[m.from].pop(); st.foundations[c.s].push(c) }
  else if (m.k === 'tc') { st.free[m.cell] = st.tableau[m.from].pop() }
  else if (m.k === 'ft') { st.tableau[m.to].push(st.free[m.cell]); st.free[m.cell] = null }
  else if (m.k === 'ff') { const c = st.free[m.cell]; st.foundations[c.s].push(c); st.free[m.cell] = null }
}

// Enumerate candidate moves from a state (excluding safe-foundation auto moves,
// which the solver applies up front). Ordered roughly best-first.
function candidateMoves(st) {
  const moves = []
  // free cell / tableau-top -> foundation (non-safe ones still worth trying)
  for (let i = 0; i < 4; i++) {
    const c = st.free[i]
    if (c && foundationWants(st.foundations[c.s], c)) moves.push({ k: 'ff', cell: i, pr: 100 })
  }
  for (let i = 0; i < 8; i++) {
    const col = st.tableau[i]
    if (col.length && foundationWants(st.foundations[col[col.length - 1].s], col[col.length - 1])) moves.push({ k: 'tf', from: i, pr: 100 })
  }
  // free cell -> tableau
  for (let i = 0; i < 4; i++) {
    const c = st.free[i]
    if (!c) continue
    for (let j = 0; j < 8; j++) {
      const dest = st.tableau[j]
      if (canStackTableau(dest, c)) moves.push({ k: 'ft', cell: i, to: j, pr: dest.length === 0 ? 20 : 70 })
    }
  }
  // tableau run -> tableau
  for (let i = 0; i < 8; i++) {
    const col = st.tableau[i]
    if (!col.length) continue
    let k = col.length - 1
    while (k > 0 && isRed(col[k - 1].s) !== isRed(col[k].s) && col[k - 1].r === col[k].r + 1) k--
    for (let start = k; start < col.length; start++) {
      const run = col.slice(start)
      const movableNonEmpty = run.length <= maxSupermove(st, false)
      for (let j = 0; j < 8; j++) {
        if (j === i) continue
        const dest = st.tableau[j]
        const toEmpty = dest.length === 0
        if (toEmpty && start === 0) continue // don't shuffle a whole column to another empty
        if (!toEmpty && !canStackTableau(dest, run[0])) continue
        const cap = toEmpty ? maxSupermove(st, true) : (movableNonEmpty ? run.length : -1)
        if (run.length > cap) continue
        // prefer moves that empty a column or land on a parent
        let pr = 50
        if (start === 0) pr = 40 // empties a column
        if (!toEmpty) pr = 60
        moves.push({ k: 'tt', from: i, start, to: j, pr })
      }
    }
  }
  // tableau top -> free cell (last resort: parking)
  const cell = st.free.indexOf(null)
  if (cell >= 0) {
    for (let i = 0; i < 8; i++) {
      const col = st.tableau[i]
      if (col.length) moves.push({ k: 'tc', from: i, cell, pr: 10 - col.length * 0 })
    }
  }
  moves.sort((a, b) => b.pr - a.pr)
  return moves
}

// Apply all safe foundation moves to a state, returning the list of moves made.
function applySafe(st) {
  const made = []
  let again = true
  while (again) {
    again = false
    for (let i = 0; i < 4; i++) {
      const c = st.free[i]
      if (c && safeToFoundation(st, c)) { st.foundations[c.s].push(c); st.free[i] = null; made.push({ k: 'ff', cell: i }); again = true }
    }
    for (let i = 0; i < 8; i++) {
      const col = st.tableau[i]
      if (col.length && safeToFoundation(st, col[col.length - 1])) {
        made.push({ k: 'tf', from: i }); const c = col.pop(); st.foundations[c.s].push(c); again = true
      }
    }
  }
  return made
}

// Iterative DFS solver with visited-set + node budget. Returns a flat list of
// moves (including auto safe-foundation moves) that wins, or null. Iterative to
// avoid stack overflow on deep (hundreds of moves) solutions.
function solve(start, budget = 400000) {
  const visited = new Set()
  let nodes = 0
  // Each stack frame: { st, enterMoves, cands, ci, applied (bool) }
  // enterMoves = the auto safe-foundation moves applied on entering this node
  // (recorded so the final path can include them).
  const root = cloneState(start)
  const rootAuto = applySafe(root)
  if (isWon(root)) return rootAuto
  const stack = [{ st: root, enterMoves: rootAuto, move: null, cands: candidateMoves(root), ci: 0 }]
  visited.add(stateKey(root))

  while (stack.length) {
    if (nodes++ > budget) return null
    const top = stack[stack.length - 1]
    if (top.ci >= top.cands.length) { stack.pop(); continue }
    const m = top.cands[top.ci++]
    const child = cloneState(top.st)
    applyMove(child, m)
    const auto = applySafe(child)
    if (isWon(child)) {
      // Reconstruct the full move list. Each frame was reached by its `move`
      // (null for root) followed by its `enterMoves` (safe autos). Then the
      // winning step is `m` followed by the child's `auto`.
      const path = []
      for (const f of stack) {
        if (f.move) path.push(f.move)
        for (const e of f.enterMoves) path.push(e)
      }
      path.push(m)
      for (const e of auto) path.push(e)
      return path
    }
    const key = stateKey(child)
    if (visited.has(key)) continue
    visited.add(key)
    stack.push({ st: child, enterMoves: auto, move: m, cands: candidateMoves(child), ci: 0 })
  }
  return null
}

// Build a deck whose deal the solver can fully win, returning both the deck and
// its winning move list. FreeCell deals are ~99.99% solvable; we re-deal until
// the solver confirms (usually within a couple of tries).
function buildSolvableDeck() {
  for (let attempt = 0; attempt < 200; attempt++) {
    const deck = fairDeck()
    const sol = solve(dealLayout(deck))
    if (sol) return { deck, solution: sol }
  }
  const deck = stackedSolvableDeck()
  return { deck, solution: solve(dealLayout(deck)) }
}

// Deterministic near-sorted deck the solver always wins (used only as a fallback
// if a solvable random deal somehow isn't found): each column is built so low
// cards surface quickly. The solver still verifies this at the call site in tests.
function stackedSolvableDeck() {
  const all = []
  for (let s = 0; s < 4; s++) for (let r = 0; r < 13; r++) all.push(mk(r, s))
  all.sort((a, b) => (b.r - a.r) || (a.s - b.s))
  const cols = [[], [], [], [], [], [], [], []]
  for (let i = 0; i < 52; i++) cols[i % 8].push(all[i])
  for (const col of cols) col.sort((a, b) => b.r - a.r) // deepest highest, top lowest
  const deck = new Array(52)
  const counts = [0, 0, 0, 0, 0, 0, 0, 0]
  for (let i = 0; i < 52; i++) { const c = i % 8; deck[i] = cols[c][counts[c]++] }
  return deck
}

export default function FreeCell() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const auto = isAutoplay('freecell')

    // ---------- layout geometry ----------
    const CW = 76
    const CH = 104
    const GAP = 9
    const MARGIN = 18
    const TOP_Y = 74        // free cells + foundations row
    const TABLEAU_Y = 218   // cascades top
    const FAN = 27
    const colX = (i) => MARGIN + i * (CW + GAP)

    // ---------- state ----------
    let st = null
    let moves = 0
    let startTime = 0
    let elapsed = 0
    let phase = 'playing' // 'playing' | 'won'
    let sel = null        // { type:'free', idx } | { type:'tableau', col, idx }
    let best
    try { best = JSON.parse(localStorage.getItem(BEST_KEY)) } catch { best = null }
    if (!best || typeof best !== 'object') best = { wins: 0, fewest: null }

    let autoTimer = null
    let sessionRecorded = false
    let autoStallCount = 0
    let autoSolution = null   // precomputed winning move list (win rounds)
    let autoSolIdx = 0

    function newGame() {
      let deck
      autoSolution = null
      autoSolIdx = 0
      if (auto) {
        const wantWin = shouldAutoWin('freecell')
        if (wantWin) {
          const built = buildSolvableDeck()
          deck = built.deck
          autoSolution = built.solution // guaranteed non-null for a built deck
        } else {
          deck = fairDeck() // hard deal: bot plays greedily and likely stalls
        }
      } else {
        deck = fairDeck()
      }
      st = dealLayout(deck)
      moves = 0
      startTime = performance.now()
      elapsed = 0
      phase = 'playing'
      sel = null
      sessionRecorded = false
      autoStallCount = 0
      if (auto) scheduleAuto()
    }

    function checkWin() {
      if (phase === 'playing' && isWon(st)) {
        phase = 'won'
        best.wins = (best.wins || 0) + 1
        if (best.fewest == null || moves < best.fewest) best.fewest = moves
        try { localStorage.setItem(BEST_KEY, JSON.stringify(best)) } catch { /* ignore */ }
        if (auto && !sessionRecorded) { sessionRecorded = true; recordAutoplayResult('freecell', true) }
      }
    }

    // ---------- move primitives (live state) ----------
    // Attempt to drop the current selection onto a target. Returns bool.
    function moveSelTo(target) {
      if (!sel) return false
      // gather the moving cards
      let moving = null
      if (sel.type === 'free') {
        const c = st.free[sel.idx]
        if (!c) return false
        moving = [c]
      } else if (sel.type === 'tableau') {
        const col = st.tableau[sel.col]
        moving = col.slice(sel.idx)
        if (!isRun(moving)) return false
      }
      if (!moving || !moving.length) return false

      if (target.type === 'foundation') {
        if (moving.length !== 1) return false
        const c = moving[0]
        if (!foundationWants(st.foundations[c.s], c)) return false
        removeMoving()
        st.foundations[c.s].push(c)
      } else if (target.type === 'free') {
        if (moving.length !== 1) return false
        if (st.free[target.idx] !== null) return false
        removeMoving()
        st.free[target.idx] = moving[0]
      } else if (target.type === 'tableau') {
        const dest = st.tableau[target.col]
        if (!canStackTableau(dest, moving[0])) return false
        if (moving.length > maxSupermove(st, dest.length === 0)) return false
        removeMoving()
        st.tableau[target.col] = dest.concat(moving)
      } else return false

      moves++
      checkWin()
      return true
    }

    function removeMoving() {
      if (sel.type === 'free') st.free[sel.idx] = null
      else if (sel.type === 'tableau') st.tableau[sel.col].splice(sel.idx)
    }

    // Send a card (free cell or tableau top) to its foundation if legal.
    function sendToFoundation(spec) {
      if (spec.type === 'free') {
        const c = st.free[spec.idx]
        if (c && foundationWants(st.foundations[c.s], c)) {
          st.foundations[c.s].push(c); st.free[spec.idx] = null; moves++; checkWin(); return true
        }
      } else if (spec.type === 'tableau') {
        const col = st.tableau[spec.col]
        if (!col.length) return false
        const c = col[col.length - 1]
        if (foundationWants(st.foundations[c.s], c)) {
          st.foundations[c.s].push(col.pop()); moves++; checkWin(); return true
        }
      }
      return false
    }

    // ---------- autoplay bot (live, watchable) ----------
    // Win rounds replay the solver's precomputed solution one move at a time.
    // Lose rounds (fair deck, no solution) play a simple greedy that stalls.
    function scheduleAuto() {
      if (autoTimer) clearTimeout(autoTimer)
      const delay = 250 + Math.random() * 200 // 250-450ms
      autoTimer = setTimeout(autoStep, delay)
    }

    // Play back the next solver move on the live state.
    function replayStep() {
      if (autoSolIdx >= autoSolution.length) return false
      const m = autoSolution[autoSolIdx++]
      applyMove(st, m)
      moves++
      checkWin()
      return true
    }

    // Simple greedy fallback for lose rounds: safe foundations, then a helpful
    // tableau run, then park to a free cell. Stalls on hard deals. Returns bool.
    function greedyStep() {
      // safe foundation moves
      for (let i = 0; i < 4; i++) {
        if (st.free[i] && safeToFoundation(st, st.free[i])) {
          const c = st.free[i]; st.foundations[c.s].push(c); st.free[i] = null; moves++; checkWin(); return true
        }
      }
      for (let i = 0; i < 8; i++) {
        const col = st.tableau[i]
        if (col.length && safeToFoundation(st, col[col.length - 1])) {
          const c = col.pop(); st.foundations[c.s].push(c); moves++; checkWin(); return true
        }
      }
      // a helpful tableau-top run onto a parent (not onto empty, to avoid churn)
      for (let i = 0; i < 8; i++) {
        const col = st.tableau[i]
        if (!col.length) continue
        let k = col.length - 1
        while (k > 0 && isRed(col[k - 1].s) !== isRed(col[k].s) && col[k - 1].r === col[k].r + 1) k--
        const run = col.slice(k)
        if (run.length > maxSupermove(st, false)) continue
        for (let j = 0; j < 8; j++) {
          if (j === i || st.tableau[j].length === 0) continue
          if (canStackTableau(st.tableau[j], run[0]) && k > 0) {
            st.tableau[i].splice(k); st.tableau[j] = st.tableau[j].concat(run); moves++; return true
          }
        }
      }
      // free cell -> tableau parent
      for (let i = 0; i < 4; i++) {
        const c = st.free[i]
        if (!c) continue
        for (let j = 0; j < 8; j++) {
          if (st.tableau[j].length && canStackTableau(st.tableau[j], c)) {
            st.tableau[j].push(c); st.free[i] = null; moves++; return true
          }
        }
      }
      return false // stalled
    }

    function autoStep() {
      if (phase === 'won') {
        autoTimer = setTimeout(() => { newGame() }, 1500)
        return
      }
      const progressed = autoSolution ? replayStep() : greedyStep()
      if (progressed) { autoStallCount = 0; return scheduleAuto() }
      // no move available -> stalled (the ~5% lose round)
      autoStallCount++
      if (autoStallCount > 1) {
        if (!sessionRecorded) { sessionRecorded = true; recordAutoplayResult('freecell', false) }
        autoTimer = setTimeout(() => { newGame() }, 1500)
        return
      }
      return scheduleAuto()
    }

    // ---------- hit testing ----------
    function topYofCard(col, idx) {
      return TABLEAU_Y + idx * FAN
    }

    function hitTest(mx, my) {
      // free cells (cols 0..3)
      for (let i = 0; i < 4; i++) {
        const x = colX(i)
        if (mx >= x && mx <= x + CW && my >= TOP_Y && my <= TOP_Y + CH) return { type: 'free', idx: i }
      }
      // foundations (cols 4..7)
      for (let s = 0; s < 4; s++) {
        const x = colX(4 + s)
        if (mx >= x && mx <= x + CW && my >= TOP_Y && my <= TOP_Y + CH) return { type: 'foundation', s }
      }
      // tableau columns
      for (let col = 0; col < 8; col++) {
        const x = colX(col)
        if (mx < x || mx > x + CW) continue
        const cards = st.tableau[col]
        if (cards.length === 0) {
          if (my >= TABLEAU_Y && my <= TABLEAU_Y + CH) return { type: 'tableau', col, idx: 0, empty: true }
          continue
        }
        for (let i = cards.length - 1; i >= 0; i--) {
          const cy = topYofCard(col, i)
          const isTop = i === cards.length - 1
          const h = isTop ? CH : FAN
          if (my >= cy && my <= cy + h) return { type: 'tableau', col, idx: i }
        }
      }
      return null
    }

    // ---------- input ----------
    let lastClickT = 0
    let lastClickKey = ''
    function onPointer(e) {
      if (auto) return
      const rect = canvas.getBoundingClientRect()
      const mx = (e.clientX - rect.left) * (W / rect.width)
      const my = (e.clientY - rect.top) * (H / rect.height)
      if (phase === 'won') return

      const hit = hitTest(mx, my)
      if (!hit) { sel = null; return }

      const now = performance.now()
      const key = JSON.stringify(hit)
      const dbl = now - lastClickT < 320 && key === lastClickKey
      lastClickT = now
      lastClickKey = key

      // double-click -> send to foundation
      if (dbl) {
        if (hit.type === 'free') { if (sendToFoundation({ type: 'free', idx: hit.idx })) { sel = null; return } }
        if (hit.type === 'tableau' && !hit.empty) {
          const col = st.tableau[hit.col]
          if (col.length && hit.idx === col.length - 1) {
            if (sendToFoundation({ type: 'tableau', col: hit.col })) { sel = null; return }
          }
        }
      }

      if (!sel) {
        // pick up
        if (hit.type === 'free') { if (st.free[hit.idx]) sel = { type: 'free', idx: hit.idx }; return }
        if (hit.type === 'foundation') return
        if (hit.type === 'tableau') {
          const col = st.tableau[hit.col]
          if (hit.empty || col.length === 0) return
          if (isRun(col.slice(hit.idx))) sel = { type: 'tableau', col: hit.col, idx: hit.idx }
        }
        return
      }

      // have a selection -> drop
      let target = null
      if (hit.type === 'foundation') target = { type: 'foundation', s: hit.s }
      else if (hit.type === 'free') target = { type: 'free', idx: hit.idx }
      else if (hit.type === 'tableau') target = { type: 'tableau', col: hit.col }

      if (target) {
        if (sel.type === 'tableau' && target.type === 'tableau' && sel.col === target.col) { sel = null; return }
        if (sel.type === 'free' && target.type === 'free' && sel.idx === target.idx) { sel = null; return }
        const did = moveSelTo(target)
        sel = null
        if (!did && hit.type === 'tableau' && !hit.empty) {
          const col = st.tableau[hit.col]
          if (col.length && isRun(col.slice(hit.idx))) sel = { type: 'tableau', col: hit.col, idx: hit.idx }
        }
      }
    }

    function onKey(e) {
      if (e.key === 'n' || e.key === 'N') { if (!auto) newGame() }
    }

    canvas.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)

    // ---------- drawing ----------
    function roundRect(x, y, w, h, r) {
      ctx.beginPath()
      ctx.moveTo(x + r, y)
      ctx.arcTo(x + w, y, x + w, y + h, r)
      ctx.arcTo(x + w, y + h, x, y + h, r)
      ctx.arcTo(x, y + h, x, y, r)
      ctx.arcTo(x, y, x + w, y, r)
      ctx.closePath()
    }

    function drawEmptySlot(x, y, glyph, accent) {
      ctx.save()
      roundRect(x, y, CW, CH, 8)
      ctx.strokeStyle = accent || 'rgba(255,45,111,0.35)'
      ctx.lineWidth = 1.5
      ctx.setLineDash([5, 4])
      ctx.stroke()
      ctx.setLineDash([])
      if (glyph) {
        ctx.fillStyle = 'rgba(138,147,173,0.35)'
        ctx.font = '30px serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(glyph, x + CW / 2, y + CH / 2)
      }
      ctx.restore()
    }

    function drawCardFace(x, y, c, glow) {
      ctx.save()
      if (glow) { ctx.shadowColor = BLUE; ctx.shadowBlur = 18 }
      roundRect(x, y, CW, CH, 8)
      ctx.fillStyle = CARD_FACE
      ctx.fill()
      ctx.shadowBlur = 0
      ctx.strokeStyle = glow ? BLUE : 'rgba(255,255,255,0.18)'
      ctx.lineWidth = glow ? 2 : 1.2
      ctx.stroke()
      const col = isRed(c.s) ? '#ff5b7f' : '#dfe6f5'
      ctx.fillStyle = col
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.font = 'bold 18px ui-monospace, Menlo, monospace'
      ctx.fillText(RANKS[c.r], x + 7, y + 6)
      ctx.font = '16px serif'
      ctx.fillText(SUITS[c.s], x + 7, y + 26)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = '34px serif'
      ctx.globalAlpha = 0.9
      ctx.fillText(SUITS[c.s], x + CW / 2, y + CH / 2 + 6)
      ctx.globalAlpha = 1
      ctx.textAlign = 'right'
      ctx.textBaseline = 'bottom'
      ctx.font = 'bold 18px ui-monospace, Menlo, monospace'
      ctx.fillText(RANKS[c.r], x + CW - 7, y + CH - 6)
      ctx.restore()
    }

    function label(text, x, y, accent) {
      ctx.save()
      ctx.fillStyle = accent || PINK
      ctx.font = 'bold 11px ui-monospace, Menlo, monospace'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
      ctx.fillText(text.toUpperCase(), x, y)
      const w = ctx.measureText(text.toUpperCase()).width
      ctx.strokeStyle = accent || PINK
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(x, y + 4)
      ctx.lineTo(x + w, y + 4)
      ctx.stroke()
      ctx.restore()
    }

    function sparkle(x, y) {
      ctx.save()
      ctx.fillStyle = 'rgba(255,45,111,0.7)'
      ctx.font = '12px serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('+', x, y)
      ctx.restore()
    }

    function draw_frame() {
      ctx.fillStyle = BG
      ctx.fillRect(0, 0, W, H)
      const g = ctx.createRadialGradient(W / 2, H / 2, 60, W / 2, H / 2, W * 0.7)
      g.addColorStop(0, FELT)
      g.addColorStop(1, BG)
      ctx.fillStyle = g
      ctx.fillRect(0, 0, W, H)

      sparkle(12, 12); sparkle(W - 12, 12); sparkle(12, H - 12); sparkle(W - 12, H - 12)

      // header
      ctx.fillStyle = BLUE
      ctx.font = 'bold 20px ui-monospace, Menlo, monospace'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillText('FREECELL', MARGIN, 16)
      ctx.fillStyle = MUTED
      ctx.font = '12px ui-monospace, Menlo, monospace'
      ctx.fillText('PLAN IT RIGHT', MARGIN + 120, 22)

      // stats (right)
      ctx.textAlign = 'right'
      ctx.fillStyle = GOLD
      ctx.font = 'bold 14px ui-monospace, Menlo, monospace'
      const secs = Math.floor(elapsed / 1000)
      const tstr = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`
      ctx.fillText(`MOVES ${moves}   TIME ${tstr}`, W - MARGIN, 18)
      ctx.fillStyle = MUTED
      ctx.font = '11px ui-monospace, Menlo, monospace'
      const fewest = best.fewest == null ? '—' : best.fewest
      ctx.fillText(`WON ${best.wins || 0}   BEST ${fewest} MOVES`, W - MARGIN, 38)

      // labels
      label('Free Cells', colX(0), 64, PINK)
      label('Foundations', colX(4), 64, PINK)

      // free cells
      for (let i = 0; i < 4; i++) {
        const x = colX(i)
        if (st.free[i]) drawCardFace(x, TOP_Y, st.free[i], sel && sel.type === 'free' && sel.idx === i)
        else drawEmptySlot(x, TOP_Y, '', 'rgba(77,124,255,0.4)')
      }
      // foundations
      for (let s = 0; s < 4; s++) {
        const x = colX(4 + s)
        const f = st.foundations[s]
        if (f.length) drawCardFace(x, TOP_Y, f[f.length - 1], false)
        else drawEmptySlot(x, TOP_Y, SUITS[s], 'rgba(84,227,70,0.4)')
      }

      // tableau cascades
      for (let col = 0; col < 8; col++) {
        const x = colX(col)
        const cards = st.tableau[col]
        if (cards.length === 0) { drawEmptySlot(x, TABLEAU_Y, '', 'rgba(255,45,111,0.25)'); continue }
        for (let i = 0; i < cards.length; i++) {
          const selectedHere = sel && sel.type === 'tableau' && sel.col === col && i >= sel.idx
          drawCardFace(x, TABLEAU_Y + i * FAN, cards[i], selectedHere)
        }
      }

      // win banner
      if (phase === 'won') {
        ctx.save()
        ctx.fillStyle = 'rgba(10,10,10,0.78)'
        ctx.fillRect(0, 0, W, H)
        ctx.shadowColor = GREEN
        ctx.shadowBlur = 24
        ctx.fillStyle = GREEN
        ctx.font = 'bold 46px ui-monospace, Menlo, monospace'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('YOU WIN!', W / 2, H / 2 - 24)
        ctx.shadowBlur = 0
        ctx.fillStyle = GOLD
        ctx.font = 'bold 16px ui-monospace, Menlo, monospace'
        ctx.fillText(`${moves} MOVES  •  ${tstr}`, W / 2, H / 2 + 18)
        ctx.fillStyle = PINK
        ctx.font = 'bold 13px ui-monospace, Menlo, monospace'
        ctx.fillText(auto ? 'AUTOPLAY — NEXT DEAL INCOMING' : 'PRESS  N  FOR A NEW GAME', W / 2, H / 2 + 48)
        ctx.restore()
      }

      // footer hint
      if (phase === 'playing') {
        ctx.fillStyle = MUTED
        ctx.font = '11px ui-monospace, Menlo, monospace'
        ctx.textAlign = 'center'
        ctx.fillText(
          auto ? 'AUTOPLAY BOT RUNNING' : 'CLICK TO PICK UP / DROP  •  DOUBLE-CLICK → FOUNDATION  •  N = NEW GAME',
          W / 2, H - 12,
        )
      }
    }

    let raf = null
    function frame() {
      if (phase === 'playing') elapsed = performance.now() - startTime
      draw_frame()
      raf = requestAnimationFrame(frame)
    }

    newGame()
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      if (autoTimer) clearTimeout(autoTimer)
      canvas.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      className="freecell-canvas"
      aria-label="FreeCell game"
    />
  )
}
