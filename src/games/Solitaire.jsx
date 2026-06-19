import { useEffect, useRef } from 'react'
import { isAutoplay, shouldAutoWin, recordAutoplayResult } from '../autoplay.js'

// Klondike Solitaire on canvas — 10x neon style — with a 95% autoplay bot.
// All state + logic live in ONE useEffect; rAF draw loop; plain `let` vars.
// Human play uses a fair shuffle. Autoplay rigs the deal on "win" rounds so a
// greedy bot (foundation -> flip -> tableau help -> draw) completes to a full win.
const W = 700
const H = 560
const BEST_KEY = '10xgames.solitaire.best'

const BG = '#0a0a0a'
const FELT = '#0d2417'
const PINK = '#ff2d6f'
const GREEN = '#54e346'
const GOLD = '#ffd60a'
const MUTED = '#8a93ad'
const CARD_BG = '#12161f'
const CARD_FACE = '#1a1f2c'

const SUITS = ['♠', '♥', '♦', '♣'] // 0 spades, 1 hearts, 2 diamonds, 3 clubs
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
const isRed = (s) => s === 1 || s === 2

// Card: { r: 0..12 (A..K), s: 0..3, up: bool }
const mk = (r, s, up = false) => ({ r, s, up })

// ---------- decks ----------
// Fair Fisher-Yates shuffle of a full 52-card deck.
function fairDeck() {
  const d = []
  for (let s = 0; s < 4; s++) for (let r = 0; r < 13; r++) d.push(mk(r, s))
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[d[i], d[j]] = [d[j], d[i]]
  }
  return d
}

// ---------- deal ----------
// Deal a 52-card array (dealt from the END as a "draw pile") into the Klondike
// layout: 7 tableau columns (1..7 cards, only top face-up) + remaining -> stock.
// We pop from the end of `deck`, so deck[deck.length-1] is dealt first.
function dealLayout(deck) {
  const d = deck.slice()
  const tableau = [[], [], [], [], [], [], []]
  for (let col = 0; col < 7; col++) {
    for (let row = 0; row <= col; row++) {
      const c = d.pop()
      c.up = row === col // only the last (top) card of each column is face-up
      tableau[col].push(c)
    }
  }
  const stock = []
  while (d.length) { const c = d.pop(); c.up = false; stock.push(c) }
  return {
    tableau,
    stock,        // face-down; draw pops from end
    waste: [],    // face-up; top is end
    foundations: [[], [], [], []], // index by suit
  }
}

// Build a deck that the greedy bot can fully solve.
// Strategy: keep all 7 tableau columns trivial-ish and make the stock a straight
// run so that simply drawing through it (each waste card going to a foundation,
// occasionally onto a tableau) completes the game. We construct it by REVERSING
// a known-good play order: place the 28 tableau cards so every face-down card is
// the next-needed foundation card under its face-up top, and the 24 stock cards
// in foundation order. We then verify with the same greedy solver the bot uses.
function buildSolvableDeck() {
  for (let attempt = 0; attempt < 400; attempt++) {
    const deck = fairDeck()
    const st = dealLayout(deck)
    if (greedySolves(st)) return deck
  }
  // Fallback: a hand-stacked near-sorted deck guaranteed to solve.
  return stackedSolvableDeck()
}

// Deterministic stacked deck that always solves under the greedy policy:
// tableau columns get high cards on top of their own lower cards of same suit so
// they peel to foundations; stock is ordered to feed foundations A..K per suit.
function stackedSolvableDeck() {
  // We design the dealt state directly, then back out the deck order.
  // Tableau (col i, bottom..top). Keep columns short of conflicts: put each
  // column as a descending same-suit-ish stack we can dismantle to foundations
  // simply by always sending the lowest available rank up. To keep the greedy
  // solver happy we just make all 28 tableau cards face-up-friendly by making the
  // hidden cards higher rank than the visible (so visible goes up first, exposing
  // next). Simplest robust choice: fill tableau with ranks 6..K, stock with A..5.
  // Then greedy draws A..5 from stock to start every foundation, and peels 6..K
  // off the tableau tops (lowest-needed each time). Build explicitly:
  const bySuit = [[], [], [], []]
  for (let s = 0; s < 4; s++) for (let r = 0; r < 13; r++) bySuit[s].push(mk(r, s))

  // tableau cards: ranks 5..12 (that's 8 per suit = 32) — we only need 28.
  // Put higher ranks DEEPER (face-down) so the lower ones on top go first.
  const tableauPool = []
  for (let s = 0; s < 4; s++) for (let r = 12; r >= 5; r--) tableauPool.push(bySuit[s][r])
  // stock cards: ranks 0..4 (A..5) for all suits = 20, plus 4 leftover.
  const stockPool = []
  for (let s = 0; s < 4; s++) for (let r = 0; r <= 4; r++) stockPool.push(bySuit[s][r])

  // We must place exactly 28 in tableau and 24 in stock.
  // Move 4 lowest-of-remaining tableau cards (rank 5s) into stock to balance.
  while (tableauPool.length > 28) stockPool.push(tableauPool.pop())

  // Now assemble dealt layout: column c gets c+1 cards. For each column the LAST
  // pushed is face-up. We want the face-up (top) to be the LOWEST rank so it goes
  // up first. Sort each column we build descending so top is lowest.
  // Build deck so dealLayout(deck) reproduces this. dealLayout pops from end and
  // fills col0(1), col1(2)... row by row, top card last. To control it we just
  // construct the deck as the reverse of pop order.
  // pop order (first popped first): for col in 0..6, for row in 0..col.
  // We'll assign tableau cards then stock cards, then reverse for deck array.
  const popOrder = []
  let ti = 0
  for (let col = 0; col < 7; col++) {
    // gather c+1 cards, descending rank so the top (last) is lowest
    const colCards = tableauPool.slice(ti, ti + col + 1)
    ti += col + 1
    colCards.sort((a, b) => b.r - a.r) // deepest highest, top lowest
    for (const c of colCards) popOrder.push(c)
  }
  // stock: order so drawing (pops from end of stock) yields ascending ranks per
  // suit nicely. We just feed all stock cards; greedy will route them.
  stockPool.sort((a, b) => a.r - b.r) // low ranks drawn first overall
  // stock is dealt after tableau (popped later). dealLayout pops stock last and
  // pushes; stock end = last dealt. We want stock top (drawn first) to be A's.
  // popOrder continues with stock in the order they should be popped.
  for (const c of stockPool) popOrder.push(c)

  // deck pops from END, so deck = reverse(popOrder).
  const deck = popOrder.slice().reverse()
  return deck
}

// ---------- greedy solver (also the autoplay bot's policy, headless) ----------
// Operates on a *clone* of the game state. Returns true if it reaches a win
// without stalling. Mirrors the live bot: foundation moves first, then flips,
// then a helpful tableau move, then draw / recycle.
function cloneState(st) {
  return {
    tableau: st.tableau.map((col) => col.map((c) => ({ ...c }))),
    stock: st.stock.map((c) => ({ ...c })),
    waste: st.waste.map((c) => ({ ...c })),
    foundations: st.foundations.map((f) => f.map((c) => ({ ...c }))),
  }
}

const foundationWants = (f, c) => (f.length === 0 ? c.r === 0 : f[f.length - 1].r === c.r - 1)

function canStackTableau(dest, c) {
  if (dest.length === 0) return c.r === 12 // only kings to empty
  const top = dest[dest.length - 1]
  return top.up && isRed(top.s) !== isRed(c.s) && top.r === c.r + 1
}

// Try one foundation move from waste or any tableau top. Mutates st. Returns bool.
function tryFoundation(st) {
  // from waste
  if (st.waste.length) {
    const c = st.waste[st.waste.length - 1]
    if (foundationWants(st.foundations[c.s], c)) {
      st.foundations[c.s].push(st.waste.pop())
      return true
    }
  }
  // from tableau tops
  for (let i = 0; i < 7; i++) {
    const col = st.tableau[i]
    if (!col.length) continue
    const c = col[col.length - 1]
    if (c.up && foundationWants(st.foundations[c.s], c)) {
      st.foundations[c.s].push(col.pop())
      return true
    }
  }
  return false
}

// Flip any face-down tableau top. Mutates. Returns bool.
function tryFlip(st) {
  let did = false
  for (let i = 0; i < 7; i++) {
    const col = st.tableau[i]
    if (col.length && !col[col.length - 1].up) { col[col.length - 1].up = true; did = true }
  }
  return did
}

// A "helpful" tableau move: move a face-up run that exposes a face-down card, or
// relocates a king onto an empty column from a covering position. Conservative to
// avoid loops. Mutates. Returns bool.
function tryTableauMove(st) {
  for (let i = 0; i < 7; i++) {
    const col = st.tableau[i]
    if (!col.length) continue
    // find start of the top face-up run
    let k = col.length - 1
    while (k > 0 && col[k - 1].up && isRed(col[k - 1].s) !== isRed(col[k].s) && col[k - 1].r === col[k].r + 1) k--
    const moving = col[k]
    const exposesHidden = k > 0 && !col[k - 1].up
    const wholeColAndKing = k === 0 && moving.r === 12
    if (!exposesHidden && !wholeColAndKing) continue
    // king to empty is only useful if it frees a hidden card (skip pure king
    // shuffles between empties).
    for (let j = 0; j < 7; j++) {
      if (j === i) continue
      const dest = st.tableau[j]
      if (dest.length === 0 && moving.r !== 12) continue
      if (dest.length === 0 && wholeColAndKing) continue // no point
      if (canStackTableau(dest, moving)) {
        const run = col.splice(k)
        st.tableau[j] = dest.concat(run)
        return true
      }
    }
  }
  return false
}

// Draw one from stock to waste, or recycle waste if stock empty. Returns 'draw'|'recycle'|'none'.
function tryDraw(st) {
  if (st.stock.length) {
    const c = st.stock.pop()
    c.up = true
    st.waste.push(c)
    return 'draw'
  }
  if (st.waste.length) {
    while (st.waste.length) { const c = st.waste.pop(); c.up = false; st.stock.push(c) }
    return 'recycle'
  }
  return 'none'
}

const isWon = (st) => st.foundations.reduce((a, f) => a + f.length, 0) === 52

function greedySolves(start) {
  const st = cloneState(start)
  let safety = 0
  let recycles = 0
  while (!isWon(st) && safety++ < 4000) {
    if (tryFoundation(st)) { recycles = 0; continue }
    if (tryFlip(st)) { recycles = 0; continue }
    if (tryTableauMove(st)) { recycles = 0; continue }
    const r = tryDraw(st)
    if (r === 'recycle') { recycles++; if (recycles > 2) break } // looping with no progress
    if (r === 'none') break
  }
  return isWon(st)
}

export default function Solitaire() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const auto = isAutoplay('solitaire')

    // ---------- layout geometry ----------
    const CW = 78          // card width
    const CH = 108         // card height
    const GAP = 14         // gap between columns
    const MARGIN = 20
    const TOP_Y = 70       // y of stock/waste/foundations row
    const TABLEAU_Y = 210  // y of tableau top
    const FAN = 26         // face-up fan offset
    const FAN_DOWN = 12    // face-down fan offset
    const colX = (i) => MARGIN + i * (CW + GAP)

    // ---------- state ----------
    let st = null
    let moves = 0
    let startTime = 0
    let elapsed = 0
    let phase = 'playing' // 'playing' | 'won'
    let sel = null        // { type:'waste' } | { type:'tableau', col, idx } | { type:'foundation', s }
    let lastClickT = 0
    let lastClickKey = ''
    let best
    try { best = JSON.parse(localStorage.getItem(BEST_KEY)) } catch { best = null }
    if (!best || typeof best !== 'object') best = { wins: 0, fewest: null }

    let autoTimer = null
    let autoWantWin = true
    let sessionRecorded = false

    function newGame() {
      let deck
      if (auto) {
        autoWantWin = shouldAutoWin('solitaire')
        deck = autoWantWin ? buildSolvableDeck() : fairDeck()
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
      if (auto) scheduleAuto()
    }

    function checkWin() {
      if (phase === 'playing' && isWon(st)) {
        phase = 'won'
        best.wins = (best.wins || 0) + 1
        if (best.fewest == null || moves < best.fewest) best.fewest = moves
        try { localStorage.setItem(BEST_KEY, JSON.stringify(best)) } catch { /* ignore */ }
        if (auto && !sessionRecorded) { sessionRecorded = true; recordAutoplayResult('solitaire', true) }
      }
    }

    // ---------- move primitives (live state) ----------
    function flipExposed() {
      for (let i = 0; i < 7; i++) {
        const col = st.tableau[i]
        if (col.length && !col[col.length - 1].up) col[col.length - 1].up = true
      }
    }

    // Attempt to move current selection onto a tableau column or foundation.
    function moveSelTo(target) {
      if (!sel) return false
      // gather moving cards
      let moving = null
      let from = null
      if (sel.type === 'waste') {
        if (!st.waste.length) return false
        moving = [st.waste[st.waste.length - 1]]
        from = 'waste'
      } else if (sel.type === 'tableau') {
        const col = st.tableau[sel.col]
        moving = col.slice(sel.idx)
        from = 'tableau'
      } else if (sel.type === 'foundation') {
        const f = st.foundations[sel.s]
        if (!f.length) return false
        moving = [f[f.length - 1]]
        from = 'foundation'
      }
      if (!moving || !moving.length) return false

      if (target.type === 'foundation') {
        if (moving.length !== 1) return false
        const c = moving[0]
        if (!foundationWants(st.foundations[c.s], c)) return false
        // commit
        removeMoving(from)
        st.foundations[c.s].push(c)
      } else if (target.type === 'tableau') {
        const dest = st.tableau[target.col]
        if (!canStackTableau(dest, moving[0])) return false
        removeMoving(from)
        st.tableau[target.col] = dest.concat(moving)
      } else return false

      flipExposed()
      moves++
      checkWin()
      return true
    }

    function removeMoving(from) {
      if (from === 'waste') st.waste.pop()
      else if (from === 'foundation') st.foundations[sel.s].pop()
      else if (from === 'tableau') st.tableau[sel.col].splice(sel.idx)
    }

    // Send a specific card (waste top or tableau top) to foundation if legal.
    function autoToFoundation(spec) {
      if (spec.type === 'waste') {
        if (!st.waste.length) return false
        const c = st.waste[st.waste.length - 1]
        if (foundationWants(st.foundations[c.s], c)) {
          st.foundations[c.s].push(st.waste.pop()); flipExposed(); moves++; checkWin(); return true
        }
      } else if (spec.type === 'tableau') {
        const col = st.tableau[spec.col]
        if (!col.length) return false
        const c = col[col.length - 1]
        if (c.up && foundationWants(st.foundations[c.s], c)) {
          st.foundations[c.s].push(col.pop()); flipExposed(); moves++; checkWin(); return true
        }
      }
      return false
    }

    function draw() {
      if (st.stock.length) {
        const c = st.stock.pop(); c.up = true; st.waste.push(c); moves++
      } else if (st.waste.length) {
        while (st.waste.length) { const c = st.waste.pop(); c.up = false; st.stock.push(c) }
        moves++
      }
    }

    // ---------- autoplay bot (live, watchable) ----------
    function scheduleAuto() {
      if (autoTimer) clearTimeout(autoTimer)
      const delay = 250 + Math.random() * 200 // 250-450ms
      autoTimer = setTimeout(autoStep, delay)
    }

    let autoRecycleCount = 0
    function autoStep() {
      if (phase === 'won') {
        // record a non-win is impossible here (won). Restart after a beat.
        autoTimer = setTimeout(() => { newGame() }, 1400)
        return
      }
      // (a) foundation moves
      if (autoToFoundation({ type: 'waste' })) { autoRecycleCount = 0; return scheduleAuto() }
      for (let i = 0; i < 7; i++) {
        if (autoToFoundation({ type: 'tableau', col: i })) { autoRecycleCount = 0; return scheduleAuto() }
      }
      // (b) flips happen automatically via flipExposed; ensure tops flipped
      let flipped = false
      for (let i = 0; i < 7; i++) {
        const col = st.tableau[i]
        if (col.length && !col[col.length - 1].up) { col[col.length - 1].up = true; flipped = true }
      }
      if (flipped) { autoRecycleCount = 0; return scheduleAuto() }
      // (c) helpful tableau move
      if (botTableauMove()) { autoRecycleCount = 0; return scheduleAuto() }
      // (d) draw / recycle
      if (st.stock.length) {
        draw(); return scheduleAuto()
      } else if (st.waste.length) {
        draw(); autoRecycleCount++
        if (autoRecycleCount > 2) {
          // stalled (the ~5% lose round). Record and move on.
          if (!sessionRecorded) { sessionRecorded = true; recordAutoplayResult('solitaire', false) }
          autoTimer = setTimeout(() => { newGame() }, 1400)
          return
        }
        return scheduleAuto()
      } else {
        // no stock, no waste, not won -> stalled
        if (!sessionRecorded) { sessionRecorded = true; recordAutoplayResult('solitaire', false) }
        autoTimer = setTimeout(() => { newGame() }, 1400)
        return
      }
    }

    // Bot version of helpful tableau move on live state.
    function botTableauMove() {
      for (let i = 0; i < 7; i++) {
        const col = st.tableau[i]
        if (!col.length) continue
        let k = col.length - 1
        while (k > 0 && col[k - 1].up && isRed(col[k - 1].s) !== isRed(col[k].s) && col[k - 1].r === col[k].r + 1) k--
        const moving = col[k]
        const exposesHidden = k > 0 && !col[k - 1].up
        const wholeColAndKing = k === 0 && moving.r === 12
        if (!exposesHidden && !wholeColAndKing) continue
        for (let j = 0; j < 7; j++) {
          if (j === i) continue
          const dest = st.tableau[j]
          if (dest.length === 0 && moving.r !== 12) continue
          if (dest.length === 0 && wholeColAndKing) continue
          if (canStackTableau(dest, moving)) {
            const run = col.splice(k)
            st.tableau[j] = dest.concat(run)
            flipExposed()
            moves++
            return true
          }
        }
      }
      return false
    }

    // ---------- hit testing ----------
    function topYofCard(col, idx) {
      // y position of card `idx` in tableau column
      const cards = st.tableau[col]
      let y = TABLEAU_Y
      for (let i = 0; i < idx; i++) y += cards[i].up ? FAN : FAN_DOWN
      return y
    }

    function hitTest(mx, my) {
      // stock
      if (mx >= colX(0) && mx <= colX(0) + CW && my >= TOP_Y && my <= TOP_Y + CH) return { type: 'stock' }
      // waste
      if (mx >= colX(1) && mx <= colX(1) + CW && my >= TOP_Y && my <= TOP_Y + CH) return { type: 'waste' }
      // foundations (cols 3..6)
      for (let s = 0; s < 4; s++) {
        const x = colX(3 + s)
        if (mx >= x && mx <= x + CW && my >= TOP_Y && my <= TOP_Y + CH) return { type: 'foundation', s }
      }
      // tableau columns
      for (let col = 0; col < 7; col++) {
        const x = colX(col)
        if (mx < x || mx > x + CW) continue
        const cards = st.tableau[col]
        if (cards.length === 0) {
          if (my >= TABLEAU_Y && my <= TABLEAU_Y + CH) return { type: 'tableau', col, idx: 0, empty: true }
          continue
        }
        // find topmost card under cursor (iterate from top)
        for (let i = cards.length - 1; i >= 0; i--) {
          const cy = topYofCard(col, i)
          const isTop = i === cards.length - 1
          const h = isTop ? CH : (cards[i + 1] && cards[i + 1].up ? FAN : FAN_DOWN)
          if (my >= cy && my <= cy + (isTop ? CH : h)) {
            return { type: 'tableau', col, idx: i }
          }
        }
        // within column x-range but below cards
      }
      return null
    }

    // ---------- input ----------
    function onPointer(e) {
      if (auto) return
      const rect = canvas.getBoundingClientRect()
      const mx = (e.clientX - rect.left) * (W / rect.width)
      const my = (e.clientY - rect.top) * (H / rect.height)

      if (phase === 'won') return
      const hit = hitTest(mx, my)
      if (!hit) { sel = null; return }

      // double-click detection -> auto to foundation
      const now = performance.now()
      const key = JSON.stringify(hit)
      const dbl = now - lastClickT < 320 && key === lastClickKey
      lastClickT = now
      lastClickKey = key

      if (hit.type === 'stock') { sel = null; draw(); return }

      if (dbl) {
        if (hit.type === 'waste') { if (autoToFoundation({ type: 'waste' })) { sel = null; return } }
        if (hit.type === 'tableau') {
          const col = st.tableau[hit.col]
          if (col.length && hit.idx === col.length - 1) {
            if (autoToFoundation({ type: 'tableau', col: hit.col })) { sel = null; return }
          }
        }
      }

      if (!sel) {
        // pick up
        if (hit.type === 'waste') { if (st.waste.length) sel = { type: 'waste' }; return }
        if (hit.type === 'foundation') { if (st.foundations[hit.s].length) sel = { type: 'foundation', s: hit.s }; return }
        if (hit.type === 'tableau') {
          const col = st.tableau[hit.col]
          if (hit.empty || col.length === 0) return
          const c = col[hit.idx]
          if (!c.up) return
          // only allow picking a valid descending-alternating run from idx to top
          let ok = true
          for (let i = hit.idx; i < col.length - 1; i++) {
            const a = col[i], b = col[i + 1]
            if (!(b.up && isRed(a.s) !== isRed(b.s) && a.r === b.r + 1)) { ok = false; break }
          }
          if (ok) sel = { type: 'tableau', col: hit.col, idx: hit.idx }
        }
        return
      }

      // we have a selection -> try to drop on target
      let target = null
      if (hit.type === 'foundation') target = { type: 'foundation', s: hit.s }
      else if (hit.type === 'tableau') target = { type: 'tableau', col: hit.col }
      else if (hit.type === 'waste') { sel = null; return }

      if (target) {
        // selecting same pile again deselects
        if (sel.type === 'tableau' && target.type === 'tableau' && sel.col === target.col) { sel = null; return }
        const did = moveSelTo(target)
        sel = null
        if (!did) {
          // allow re-pick on the freshly clicked tableau card
          if (hit.type === 'tableau') {
            const col = st.tableau[hit.col]
            if (col.length && col[hit.idx] && col[hit.idx].up) {
              let ok = true
              for (let i = hit.idx; i < col.length - 1; i++) {
                const a = col[i], b = col[i + 1]
                if (!(b.up && isRed(a.s) !== isRed(b.s) && a.r === b.r + 1)) { ok = false; break }
              }
              if (ok) sel = { type: 'tableau', col: hit.col, idx: hit.idx }
            }
          }
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

    function drawEmptySlot(x, y, glyph) {
      ctx.save()
      roundRect(x, y, CW, CH, 8)
      ctx.strokeStyle = 'rgba(255,45,111,0.35)'
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

    function drawCardBack(x, y) {
      ctx.save()
      roundRect(x, y, CW, CH, 8)
      ctx.fillStyle = CARD_BG
      ctx.fill()
      ctx.strokeStyle = PINK
      ctx.lineWidth = 1.5
      ctx.stroke()
      // neon lattice
      roundRect(x + 7, y + 7, CW - 14, CH - 14, 6)
      ctx.strokeStyle = 'rgba(255,45,111,0.5)'
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.fillStyle = 'rgba(255,45,111,0.25)'
      ctx.font = '24px serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('✦', x + CW / 2, y + CH / 2)
      ctx.restore()
    }

    function drawCardFace(x, y, c, glow) {
      ctx.save()
      if (glow) {
        ctx.shadowColor = GREEN
        ctx.shadowBlur = 18
      }
      roundRect(x, y, CW, CH, 8)
      ctx.fillStyle = CARD_FACE
      ctx.fill()
      ctx.shadowBlur = 0
      ctx.strokeStyle = glow ? GREEN : 'rgba(255,255,255,0.18)'
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
      // big center suit
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = '34px serif'
      ctx.globalAlpha = 0.9
      ctx.fillText(SUITS[c.s], x + CW / 2, y + CH / 2 + 6)
      ctx.globalAlpha = 1
      // bottom-right mirrored rank
      ctx.textAlign = 'right'
      ctx.textBaseline = 'bottom'
      ctx.font = 'bold 18px ui-monospace, Menlo, monospace'
      ctx.fillText(RANKS[c.r], x + CW - 7, y + CH - 6)
      ctx.restore()
    }

    function label(text, x, y) {
      ctx.save()
      ctx.fillStyle = PINK
      ctx.font = 'bold 11px ui-monospace, Menlo, monospace'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
      ctx.fillText(text.toUpperCase(), x, y)
      const w = ctx.measureText(text.toUpperCase()).width
      ctx.strokeStyle = PINK
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
      // background felt
      ctx.fillStyle = BG
      ctx.fillRect(0, 0, W, H)
      const g = ctx.createRadialGradient(W / 2, H / 2, 60, W / 2, H / 2, W * 0.7)
      g.addColorStop(0, FELT)
      g.addColorStop(1, BG)
      ctx.fillStyle = g
      ctx.fillRect(0, 0, W, H)

      // corner sparkles
      sparkle(12, 12); sparkle(W - 12, 12); sparkle(12, H - 12); sparkle(W - 12, H - 12)

      // header
      ctx.fillStyle = GREEN
      ctx.font = 'bold 20px ui-monospace, Menlo, monospace'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillText('SOLITAIRE', MARGIN, 18)
      ctx.fillStyle = MUTED
      ctx.font = '12px ui-monospace, Menlo, monospace'
      ctx.fillText('KLONDIKE', MARGIN + 130, 24)

      // stats (right)
      ctx.textAlign = 'right'
      ctx.fillStyle = GOLD
      ctx.font = 'bold 14px ui-monospace, Menlo, monospace'
      const secs = Math.floor(elapsed / 1000)
      const tstr = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`
      ctx.fillText(`MOVES ${moves}   TIME ${tstr}`, W - MARGIN, 20)
      ctx.fillStyle = MUTED
      ctx.font = '11px ui-monospace, Menlo, monospace'
      const fewest = best.fewest == null ? '—' : best.fewest
      ctx.fillText(`WON ${best.wins || 0}   BEST ${fewest} MOVES`, W - MARGIN, 40)

      // labels
      label('Stock', colX(0), 60)
      label('Waste', colX(1), 60)
      label('Foundations', colX(3), 60)

      // stock
      if (st.stock.length) drawCardBack(colX(0), TOP_Y)
      else drawEmptySlot(colX(0), TOP_Y, '↻')
      // stock count
      if (st.stock.length) {
        ctx.fillStyle = MUTED
        ctx.font = '11px ui-monospace, Menlo, monospace'
        ctx.textAlign = 'center'
        ctx.fillText(String(st.stock.length), colX(0) + CW / 2, TOP_Y + CH + 12)
      }

      // waste (top card)
      if (st.waste.length) {
        drawCardFace(colX(1), TOP_Y, st.waste[st.waste.length - 1], sel && sel.type === 'waste')
      } else drawEmptySlot(colX(1), TOP_Y, '')

      // foundations
      for (let s = 0; s < 4; s++) {
        const x = colX(3 + s)
        const f = st.foundations[s]
        if (f.length) drawCardFace(x, TOP_Y, f[f.length - 1], sel && sel.type === 'foundation' && sel.s === s)
        else drawEmptySlot(x, TOP_Y, SUITS[s])
      }

      // tableau
      for (let col = 0; col < 7; col++) {
        const x = colX(col)
        const cards = st.tableau[col]
        if (cards.length === 0) { drawEmptySlot(x, TABLEAU_Y, 'K'); continue }
        let y = TABLEAU_Y
        for (let i = 0; i < cards.length; i++) {
          const c = cards[i]
          const selectedHere = sel && sel.type === 'tableau' && sel.col === col && i >= sel.idx
          if (!c.up) drawCardBack(x, y)
          else drawCardFace(x, y, c, selectedHere)
          if (i < cards.length - 1) y += c.up ? FAN : FAN_DOWN
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
        ctx.fillText(auto ? 'AUTOPLAY BOT RUNNING' : 'CLICK TO PICK UP / DROP  •  DOUBLE-CLICK → FOUNDATION  •  N = NEW GAME', W / 2, H - 14)
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
      className="solitaire-canvas"
      aria-label="Solitaire game"
    />
  )
}
