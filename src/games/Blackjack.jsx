import { useEffect, useRef } from 'react'
import { isAutoplay, shouldAutoWin, recordAutoplayResult } from '../autoplay.js'

// Blackjack (21) vs dealer on canvas, 10x neon style, with a 95% autoplay bot.
// Single useEffect, rAF draw loop for card deal animation, plain `let` state.
// Dealer hits to 17 and STANDS on soft 17 (S17). Natural blackjack pays 3:2.
const W = 560
const H = 600
const BEST_KEY = '10xgames.blackjack.best'

const PINK = '#ff2d6f'
const GREEN = '#54e346'
const GOLD = '#ffd60a'
const MUTED = '#8a93ad'

const SUITS = ['♠', '♥', '♦', '♣']
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']

// ---------- card / hand logic ----------
// A card is { r: rankIndex 0..12, s: suitIndex 0..3 }.
const isRed = (s) => s === 1 || s === 2 // hearts, diamonds

// Base value of a rank: ace = 11 (soft), face = 10, else pip.
function rankValue(r) {
  if (r === 0) return 11 // ace counts 11, downgraded later
  if (r >= 9) return 10 // 10/J/Q/K
  return r + 1
}

// Best total for a hand, treating aces as 11 then dropping to 1 while busting.
// Returns { total, soft } where soft = an ace is still counted as 11.
function handValue(cards) {
  let total = 0
  let aces = 0
  for (const c of cards) {
    total += rankValue(c.r)
    if (c.r === 0) aces++
  }
  while (total > 21 && aces > 0) { total -= 10; aces-- }
  return { total, soft: aces > 0 }
}

const isBlackjack = (cards) => cards.length === 2 && handValue(cards).total === 21

// Fresh fair shoe (single deck) shuffled with Fisher-Yates.
function freshShoe() {
  const shoe = []
  for (let s = 0; s < 4; s++) for (let r = 0; r < 13; r++) shoe.push({ r, s })
  for (let i = shoe.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shoe[i], shoe[j]] = [shoe[j], shoe[i]]
  }
  return shoe
}

const randSuit = () => Math.floor(Math.random() * 4)
const card = (r) => ({ r, s: randSuit() })

// Stack the TOP of the shoe (next dealt) for a rigged demo deal.
// Deal order is SEQUENTIAL: player[0], player[1], dealer[0], dealer[1], then hits
// draw from the top. We prepend the scripted cards so they're drawn first.
function riggedShoe(wantWin) {
  const shoe = freshShoe()
  let front
  if (wantWin) {
    // Player gets a strong 20 (two tens, stands on basic strategy), dealer shows a
    // weak 6, makes 16, must hit, and the next card (a 10) busts him to 26.
    // order: player[10,10]=20, dealer[6,10]=16, next draw 10 -> dealer 26 bust.
    front = [card(9), card(12), card(5), card(9), card(11)]
  } else {
    // ~5% lose round: player gets a stiff 20 too? No — player must LOSE on basic
    // strategy. Give player hard 16 (stands? no, 16 vs 10 hits). Instead: player
    // [10,9]=19 stands, dealer [10,10]=20 stands -> dealer wins cleanly.
    // order: player[10,9]=19, dealer[10,10]=20.
    front = [card(9), card(8), card(9), card(11)]
  }
  // Suits repeat across the deck, so prepending duplicates is harmless — the demo
  // never inspects deck integrity, and a single round can't exhaust the shoe.
  return front.concat(shoe)
}

// ---------- basic strategy (autoplay bot) ----------
// Returns 'H' | 'S' | 'D'. S17 dealer rules, no split (we never split in this demo).
function basicStrategy(player, dealerUpRank, canDouble) {
  const { total, soft } = handValue(player)
  // dealer upcard value 2..11 (ace = 11)
  const up = rankValue(dealerUpRank)
  if (soft) {
    // soft totals (an ace as 11)
    if (total >= 19) return 'S'
    if (total === 18) {
      if (up >= 9 || up === 11) return 'H'
      if ((up === 3 || up === 4 || up === 5 || up === 6) && canDouble) return 'D'
      return 'S'
    }
    // soft 13-17: double vs 4-6 (and 5-6 for 13/14), else hit
    if (canDouble && up >= 4 && up <= 6) return 'D'
    return 'H'
  }
  // hard totals
  if (total >= 17) return 'S'
  if (total >= 13 && total <= 16) return up >= 7 ? 'H' : 'S'
  if (total === 12) return (up >= 4 && up <= 6) ? 'S' : 'H'
  if (total === 11) return canDouble ? 'D' : 'H'
  if (total === 10) return (canDouble && up <= 9) ? 'D' : 'H'
  if (total === 9) return (canDouble && up >= 3 && up <= 6) ? 'D' : 'H'
  return 'H' // 8 or less
}

export default function Blackjack() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')

    const auto = isAutoplay('blackjack')

    // ---- state ----
    let chips = 500
    let bet = 25
    let shoe = []
    let player = []
    let dealer = []
    let state = 'betting' // 'betting' | 'playing' | 'dealer' | 'result'
    let result = null // 'win' | 'lose' | 'push' | 'blackjack'
    let doubled = false
    let best = 500
    let wantWin = true
    let dealtCount = 0 // for staggered deal animation (cards revealed so far)
    let dealClock = 0 // ms accumulator gating the next card reveal
    let lastTs = 0
    let raf = 0
    let autoTimer = 0

    try { best = parseInt(localStorage.getItem(BEST_KEY) || '500', 10) || 500 } catch { best = 500 }

    function saveBest() {
      if (chips > best) {
        best = chips
        try { localStorage.setItem(BEST_KEY, String(best)) } catch { /* ignore */ }
      }
    }

    // Number of cards currently "in play" that should be animated in.
    const totalCardsInPlay = () => player.length + dealer.length

    function draw_card() { return shoe.shift() }

    // Begin a round: take the bet, deal two each.
    function deal() {
      if (state !== 'betting' && state !== 'result') return
      if (bet > chips) bet = chips
      if (bet <= 0) return
      chips -= bet
      doubled = false
      result = null

      if (auto) {
        wantWin = shouldAutoWin('blackjack')
        shoe = riggedShoe(wantWin)
      } else {
        shoe = freshShoe()
      }

      player = [draw_card(), draw_card()]
      dealer = [draw_card(), draw_card()]
      state = 'playing'
      dealtCount = 0
      dealClock = 0

      // natural blackjack check happens once all 4 cards have flipped in (handled in update)
    }

    // Resolve after player stands / busts / doubles: dealer plays, settle bet.
    function settle() {
      const pv = handValue(player).total
      const dv = handValue(dealer).total
      const pBJ = isBlackjack(player)
      const dBJ = isBlackjack(dealer)

      let payout = 0 // amount returned to chips (includes original bet on win/push)
      if (pv > 21) {
        result = 'lose'
      } else if (pBJ && !dBJ) {
        result = 'blackjack'
        payout = bet + Math.round(bet * 1.5) // 3:2
      } else if (dBJ && !pBJ) {
        result = 'lose'
      } else if (dv > 21) {
        result = 'win'
        payout = bet * 2
      } else if (pv > dv) {
        result = 'win'
        payout = bet * 2
      } else if (pv < dv) {
        result = 'lose'
      } else {
        result = 'push'
        payout = bet
      }

      chips += payout
      state = 'result'
      saveBest()

      if (auto) {
        const won = result === 'win' || result === 'blackjack'
        recordAutoplayResult('blackjack', won)
      }
      // reset to a playable bet if busted out
      if (chips <= 0) { chips = 500 }
      if (bet > chips) bet = chips
    }

    // Dealer draws to 17, STANDS on soft 17 (S17).
    function playDealer() {
      while (true) {
        const { total, soft } = handValue(dealer)
        if (total < 17) { dealer.push(draw_card()); continue }
        if (total === 17 && soft) break // stand on soft 17
        break
      }
    }

    // ---- player actions ----
    function actHit() {
      if (state !== 'playing') return
      player.push(draw_card())
      const { total } = handValue(player)
      if (total >= 21) { toDealer() }
    }
    function actStand() {
      if (state !== 'playing') return
      toDealer()
    }
    function actDouble() {
      if (state !== 'playing') return
      if (player.length !== 2) return
      if (bet > chips) return // can't afford to double
      chips -= bet
      bet *= 2
      doubled = true
      player.push(draw_card())
      toDealer()
    }

    // Transition from player phase to dealer phase + settle.
    function toDealer() {
      if (handValue(player).total > 21) {
        // player bust — dealer doesn't need to draw, settle immediately
        state = 'dealer'
        settle()
        return
      }
      state = 'dealer'
      playDealer()
      settle()
    }

    function canDouble() {
      return state === 'playing' && player.length === 2 && bet <= chips
    }

    // ---- betting controls ----
    function changeBet(delta) {
      if (state !== 'betting' && state !== 'result') return
      bet = Math.max(5, Math.min(chips, bet + delta))
    }

    // ---------- buttons (hit-test rectangles, rebuilt each frame's layout) ----------
    // Layout constants used by both draw + click.
    const BTN_Y = H - 92
    const BTN_H = 56
    function bettingButtons() {
      return [
        { id: 'minus', x: 24, y: BTN_Y, w: 56, h: BTN_H, label: '−' },
        { id: 'plus', x: 88, y: BTN_Y, w: 56, h: BTN_H, label: '+' },
        { id: 'deal', x: 160, y: BTN_Y, w: W - 184, h: BTN_H, label: 'DEAL' },
      ]
    }
    function playingButtons() {
      const gap = 12
      const n = 3
      const w = (W - 48 - gap * (n - 1)) / n
      const dd = canDouble()
      return [
        { id: 'hit', x: 24, y: BTN_Y, w, h: BTN_H, label: 'HIT' },
        { id: 'stand', x: 24 + (w + gap), y: BTN_Y, w, h: BTN_H, label: 'STAND' },
        { id: 'double', x: 24 + (w + gap) * 2, y: BTN_Y, w, h: BTN_H, label: 'DOUBLE', disabled: !dd },
      ]
    }
    function resultButtons() {
      return [
        { id: 'minus', x: 24, y: BTN_Y, w: 56, h: BTN_H, label: '−' },
        { id: 'plus', x: 88, y: BTN_Y, w: 56, h: BTN_H, label: '+' },
        { id: 'deal', x: 160, y: BTN_Y, w: W - 184, h: BTN_H, label: 'NEXT' },
      ]
    }
    function currentButtons() {
      if (state === 'playing') return playingButtons()
      if (state === 'result') return resultButtons()
      return bettingButtons()
    }

    function handleButton(id) {
      switch (id) {
        case 'minus': changeBet(-5); break
        case 'plus': changeBet(5); break
        case 'deal': deal(); break
        case 'hit': actHit(); break
        case 'stand': actStand(); break
        case 'double': actDouble(); break
        default: break
      }
    }

    // ---------- input ----------
    function pointFromEvent(e) {
      const rect = canvas.getBoundingClientRect()
      const scale = W / rect.width
      return { x: (e.clientX - rect.left) * scale, y: (e.clientY - rect.top) * scale }
    }
    function onPointer(e) {
      e.preventDefault()
      if (auto) return // autoplay drives itself; ignore clicks
      const { x, y } = pointFromEvent(e)
      for (const b of currentButtons()) {
        if (b.disabled) continue
        if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) { handleButton(b.id); return }
      }
    }
    function onKey(e) {
      if (auto) return
      if (state === 'playing') {
        if (e.code === 'KeyH') { e.preventDefault(); actHit() }
        else if (e.code === 'KeyS') { e.preventDefault(); actStand() }
        else if (e.code === 'KeyD') { e.preventDefault(); actDouble() }
      } else {
        if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); deal() }
        else if (e.code === 'ArrowUp') { e.preventDefault(); changeBet(5) }
        else if (e.code === 'ArrowDown') { e.preventDefault(); changeBet(-5) }
      }
    }
    canvas.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)

    // ---------- autoplay loop ----------
    // Each step waits for any in-flight deal animation to finish, then acts.
    function scheduleAuto(delay) {
      if (!auto) return
      clearTimeout(autoTimer)
      autoTimer = setTimeout(autoStep, delay)
    }
    function dealAnimationDone() {
      return dealtCount >= totalCardsInPlay()
    }
    function autoStep() {
      if (!auto) return
      // wait for card deal animation to catch up before acting
      if (!dealAnimationDone()) { scheduleAuto(120); return }

      if (state === 'betting') {
        // pick a bet (small fraction of bankroll, min 25)
        bet = Math.max(25, Math.min(chips, Math.round(chips * 0.05 / 5) * 5))
        deal()
        scheduleAuto(900)
        return
      }
      if (state === 'playing') {
        const move = basicStrategy(player, dealer[1].r, player.length === 2 && bet <= chips)
        if (move === 'H') actHit()
        else if (move === 'D') actDouble()
        else actStand()
        scheduleAuto(850 + Math.floor(Math.random() * 250))
        return
      }
      if (state === 'dealer') {
        // dealer resolution is synchronous; just wait for reveal animation
        scheduleAuto(700)
        return
      }
      if (state === 'result') {
        scheduleAuto(1400) // let the player read the result
        // after the pause, start a new round
        clearTimeout(autoTimer)
        autoTimer = setTimeout(() => {
          state = 'betting'
          scheduleAuto(500)
        }, 1500)
        return
      }
    }

    // ---------- drawing helpers ----------
    function sparkle(x, y, s) {
      ctx.strokeStyle = PINK; ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(x - s, y); ctx.lineTo(x + s, y)
      ctx.moveTo(x, y - s); ctx.lineTo(x, y + s)
      ctx.stroke()
    }

    function roundRect(x, y, w, h, r) {
      ctx.beginPath()
      ctx.moveTo(x + r, y)
      ctx.arcTo(x + w, y, x + w, y + h, r)
      ctx.arcTo(x + w, y + h, x, y + h, r)
      ctx.arcTo(x, y + h, x, y, r)
      ctx.arcTo(x, y, x + w, y, r)
      ctx.closePath()
    }

    const CARD_W = 64
    const CARD_H = 90
    const CARD_GAP = 26 // horizontal overlap step

    // Draw a single card. faceDown renders the neon back.
    function drawCard(c, x, y, faceDown, glow) {
      ctx.save()
      if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = 22 }
      roundRect(x, y, CARD_W, CARD_H, 10)
      ctx.fillStyle = faceDown ? '#171723' : '#f5f6fa'
      ctx.fill()
      ctx.restore()

      // border
      roundRect(x, y, CARD_W, CARD_H, 10)
      ctx.lineWidth = 2
      ctx.strokeStyle = faceDown ? PINK : 'rgba(0,0,0,0.15)'
      ctx.stroke()

      if (faceDown) {
        // neon back pattern
        roundRect(x + 7, y + 7, CARD_W - 14, CARD_H - 14, 6)
        ctx.strokeStyle = 'rgba(255,45,111,0.6)'; ctx.lineWidth = 1.5; ctx.stroke()
        ctx.fillStyle = PINK
        ctx.font = '800 20px system-ui, sans-serif'
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillText('★', x + CARD_W / 2, y + CARD_H / 2)
        return
      }

      const rank = RANKS[c.r]
      const suit = SUITS[c.s]
      const color = isRed(c.s) ? '#d11d4a' : '#1a1a22'
      ctx.fillStyle = color
      ctx.textBaseline = 'top'
      // top-left rank
      ctx.textAlign = 'left'
      ctx.font = '800 16px system-ui, sans-serif'
      ctx.fillText(rank, x + 7, y + 6)
      ctx.font = '700 13px system-ui, sans-serif'
      ctx.fillText(suit, x + 7, y + 23)
      // center big suit
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.font = '800 30px system-ui, sans-serif'
      ctx.fillText(suit, x + CARD_W / 2, y + CARD_H / 2 + 4)
      // bottom-right rank (mirrored)
      ctx.save()
      ctx.translate(x + CARD_W - 7, y + CARD_H - 6)
      ctx.rotate(Math.PI)
      ctx.textAlign = 'left'; ctx.textBaseline = 'top'
      ctx.font = '800 16px system-ui, sans-serif'
      ctx.fillText(rank, 0, 0)
      ctx.restore()
    }

    // Draw a hand row. `revealCount` = how many of THIS hand's cards are flipped in
    // (the rest aren't drawn yet — deal animation). hideHole hides dealer's 2nd card.
    function drawHand(cards, x, y, revealCount, hideHole, winGlow) {
      for (let i = 0; i < cards.length; i++) {
        if (i >= revealCount) break
        const cx = x + i * (CARD_GAP + 0) + i * 16
        const faceDown = hideHole && i === 1
        drawCard(cards[i], cx, y, faceDown, winGlow)
      }
    }

    function labelBar(text, x, y, color) {
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
      ctx.fillStyle = color
      ctx.font = '800 14px system-ui, sans-serif'
      ctx.fillText(text, x, y)
      const w = ctx.measureText(text).width
      ctx.fillStyle = color
      ctx.fillRect(x, y + 6, w, 3)
    }

    function drawButton(b) {
      const active = !b.disabled
      roundRect(b.x, b.y, b.w, b.h, 12)
      ctx.fillStyle = active ? 'rgba(255,45,111,0.14)' : 'rgba(138,147,173,0.08)'
      ctx.fill()
      ctx.lineWidth = 2
      ctx.strokeStyle = active ? PINK : 'rgba(138,147,173,0.3)'
      ctx.stroke()
      ctx.fillStyle = active ? '#fff' : MUTED
      ctx.font = '800 18px system-ui, sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 1)
    }

    // ---------- main draw ----------
    function draw() {
      // felt background w/ subtle pink radial
      ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, W, H)
      const g = ctx.createRadialGradient(W / 2, H * 0.4, 40, W / 2, H * 0.4, H * 0.7)
      g.addColorStop(0, 'rgba(255,45,111,0.10)')
      g.addColorStop(1, 'rgba(255,45,111,0)')
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
      sparkle(W - 20, 22, 6); sparkle(22, 22, 5)
      sparkle(W - 20, H - 120, 5)

      // title
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'
      ctx.fillStyle = PINK
      ctx.font = '900 26px system-ui, sans-serif'
      ctx.fillText('BLACKJACK', W / 2, 36)
      const tw = ctx.measureText('BLACKJACK').width
      ctx.fillRect(W / 2 - tw / 2, 44, tw, 3)

      // chips / bet readout
      ctx.textBaseline = 'alphabetic'
      ctx.textAlign = 'left'
      ctx.fillStyle = GOLD; ctx.font = '800 16px system-ui, sans-serif'
      ctx.fillText('CHIPS ' + chips, 24, 72)
      ctx.textAlign = 'center'
      ctx.fillStyle = '#fff'
      ctx.fillText('BET ' + bet, W / 2, 72)
      ctx.textAlign = 'right'
      ctx.fillStyle = MUTED
      ctx.fillText('BEST ' + best, W - 24, 72)

      const hasCards = totalCardsInPlay() > 0 && (state !== 'betting')
      const hideHole = state === 'playing'

      // dealer area
      labelBar('DEALER', 24, 110, PINK)
      if (hasCards) {
        drawHand(dealer, 24, 124, Math.min(dealtCount, totalCardsInPlay()) >= 1 ? dealerRevealCount() : 0, hideHole, null)
        // dealer total (only the visible portion while hole hidden)
        ctx.textAlign = 'right'; ctx.fillStyle = '#fff'; ctx.font = '800 18px system-ui, sans-serif'
        if (!hideHole && dealerRevealCount() >= dealer.length) {
          ctx.fillText(String(handValue(dealer).total), W - 24, 150)
        } else if (dealerRevealCount() >= 1) {
          ctx.fillStyle = MUTED
          ctx.fillText('?', W - 24, 150)
        }
      }

      // player area
      const py = 320
      labelBar('YOU', 24, py - 14, GREEN)
      if (hasCards) {
        const winGlow = state === 'result' && (result === 'win' || result === 'blackjack') ? GREEN : null
        drawHand(player, 24, py, playerRevealCount(), false, winGlow)
        if (playerRevealCount() >= player.length) {
          ctx.textAlign = 'right'; ctx.fillStyle = '#fff'; ctx.font = '800 18px system-ui, sans-serif'
          const pv = handValue(player)
          let txt = String(pv.total)
          if (pv.soft && pv.total <= 21) txt += ' (soft)'
          ctx.fillText(txt, W - 24, py + 26)
        }
      }

      // result banner
      if (state === 'result' && result) {
        let txt, col
        if (result === 'blackjack') { txt = 'BLACKJACK! +' + Math.round(bet * 1.5); col = GOLD }
        else if (result === 'win') { txt = 'YOU WIN +' + bet; col = GREEN }
        else if (result === 'push') { txt = 'PUSH'; col = MUTED }
        else { txt = 'DEALER WINS'; col = PINK }
        ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'
        ctx.fillStyle = col
        ctx.font = '900 30px system-ui, sans-serif'
        if (result === 'win' || result === 'blackjack') { ctx.shadowColor = col; ctx.shadowBlur = 24 }
        ctx.fillText(txt, W / 2, 462)
        ctx.shadowBlur = 0
        const bw = ctx.measureText(txt).width
        ctx.fillRect(W / 2 - bw / 2, 472, bw, 3)
      } else if (state === 'betting') {
        ctx.textAlign = 'center'; ctx.fillStyle = MUTED
        ctx.font = '600 15px system-ui, sans-serif'
        ctx.fillText('Set your bet and DEAL', W / 2, 462)
      }

      // buttons
      for (const b of currentButtons()) drawButton(b)

      // hint footer
      ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(138,147,173,0.6)'
      ctx.font = '600 11px system-ui, sans-serif'
      const hint = auto ? 'AUTOPLAY DEMO' : (state === 'playing' ? 'H Hit · S Stand · D Double' : 'Dealer stands on soft 17 · BJ pays 3:2')
      ctx.fillText(hint, W / 2, H - 16)
    }

    // How many player / dealer cards are currently flipped in, derived from the
    // shared dealtCount counter (deal order: P,D,P,D, then extras as they're pushed).
    function playerRevealCount() {
      if (state === 'betting') return 0
      if (dealtCount >= totalCardsInPlay()) return player.length
      // during initial 4-card deal animation, interleave P,D,P,D
      // dealtCount cards revealed in order [P0,D0,P1,D1,...extras]
      let p = 0
      for (let i = 0; i < dealtCount; i++) { if (i % 2 === 0 && p < player.length) p++ }
      // after the first 4, extras are appended to whichever hand; simplest: reveal all
      if (dealtCount > 4) return player.length
      return Math.min(p, player.length)
    }
    function dealerRevealCount() {
      if (state === 'betting') return 0
      if (dealtCount >= totalCardsInPlay()) return dealer.length
      let d = 0
      for (let i = 0; i < dealtCount; i++) { if (i % 2 === 1 && d < dealer.length) d++ }
      if (dealtCount > 4) return dealer.length
      return Math.min(d, dealer.length)
    }

    // ---------- rAF loop: advances deal animation + redraws ----------
    function frame(ts) {
      const dt = lastTs ? ts - lastTs : 16
      lastTs = ts

      // advance the staggered deal reveal
      const target = (state === 'betting') ? 0 : totalCardsInPlay()
      if (dealtCount < target) {
        dealClock += dt
        if (dealClock >= 160) { dealClock = 0; dealtCount++ }
      } else {
        dealtCount = target
        dealClock = 0
      }

      draw()
      raf = requestAnimationFrame(frame)
    }

    if (auto) scheduleAuto(700)
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(autoTimer)
      canvas.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      className="blackjack-canvas"
      aria-label="Blackjack game"
    />
  )
}
