import { useEffect, useRef } from 'react'
import { isAutoplay, shouldAutoWin, recordAutoplayResult } from '../autoplay.js'

// Vampire-Survivors-style horde survival on canvas, 10x neon style.
// Auto-attacking hero, endless edge spawns, XP gems, level-up upgrade drafts.
const W = 640
const H = 520

const PINK = '#ff2d6f'
const CYAN = '#2de2e6'
const PURPLE = '#b14aed'
const ORANGE = '#ff8a1e'
const GREEN = '#54e346'
const BEST_KEY = '10xgames.survivors.best'

// Entity caps — keep the sim from lagging/exploding.
const MAX_ENEMIES = 220
const MAX_PROJECTILES = 160
const MAX_GEMS = 260

const WIN_THRESHOLD = 60 // seconds survived = autoplay win

const HERO_R = 12

export default function Survivors() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')

    const auto = isAutoplay('survivors')
    let wantWin = auto ? shouldAutoWin('survivors') : false
    let autoRestartAt = 0
    let recorded = false

    let hero, enemies, projectiles, gems, particles
    let time, kills, level, xp, xpNeed, state
    let spawnTimer, fireTimer, draft
    let best = Number(localStorage.getItem(BEST_KEY)) || 0
    const keys = { up: false, down: false, left: false, right: false }
    let last = performance.now(), raf = 0

    function rand(min, max) { return min + Math.random() * (max - min) }

    function newHero() {
      return {
        x: W / 2, y: H / 2,
        hp: 100, maxHp: 100,
        speed: 150,
        dmg: 12,
        fireRate: 0.55,      // seconds between volleys
        projSpeed: 360,
        projCount: 1,
        pickupRange: 70,
        invuln: 0,
      }
    }

    function xpForLevel(l) { return Math.floor(8 + l * 5 + l * l * 0.6) }

    function newGame() {
      hero = newHero()
      enemies = []
      projectiles = []
      gems = []
      particles = []
      time = 0; kills = 0; level = 1
      xp = 0; xpNeed = xpForLevel(1)
      spawnTimer = 0; fireTimer = 0
      draft = null
      recorded = false
      state = 'playing'
    }

    function readyState() {
      hero = newHero()
      enemies = []
      projectiles = []
      gems = []
      particles = []
      time = 0; kills = 0; level = 1
      xp = 0; xpNeed = xpForLevel(1)
      draft = null
      state = 'ready'
    }

    // ---------- enemies ----------
    // type tiers unlock over time for variety + ramping difficulty.
    function enemyType() {
      const t = time
      const r = Math.random()
      if (t > 75 && r < 0.12) return 'brute'   // orange tank
      if (t > 40 && r < 0.34) return 'fast'     // purple swift
      return 'grunt'                            // cyan basic
    }

    function makeEnemy() {
      const type = enemyType()
      // spawn just outside a random edge
      const side = Math.floor(Math.random() * 4)
      let x, y
      if (side === 0) { x = rand(0, W); y = -20 }
      else if (side === 1) { x = W + 20; y = rand(0, H) }
      else if (side === 2) { x = rand(0, W); y = H + 20 }
      else { x = -20; y = rand(0, H) }

      // ramp: enemies get tougher/faster as time passes
      const ramp = 1 + time / 90
      let e
      if (type === 'fast') {
        e = { x, y, r: 9, type, color: PURPLE, speed: 95 * ramp, hp: 10 * ramp, maxHp: 10 * ramp, dmg: 8, xp: 2 }
      } else if (type === 'brute') {
        e = { x, y, r: 18, type, color: ORANGE, speed: 42 * ramp, hp: 55 * ramp, maxHp: 55 * ramp, dmg: 18, xp: 6 }
      } else {
        e = { x, y, r: 12, type, color: CYAN, speed: 60 * ramp, hp: 18 * ramp, maxHp: 18 * ramp, dmg: 10, xp: 3 }
      }
      e.wob = Math.random() * Math.PI * 2
      return e
    }

    function spawnRate() {
      // enemies per second, ramps up over time
      return 1.4 + time * 0.06
    }

    function maxAlive() {
      // soft cap that grows but stays under the hard cap
      return Math.min(MAX_ENEMIES, 30 + Math.floor(time * 1.1))
    }

    // ---------- combat ----------
    function nearestEnemy(x, y) {
      let best = null, bestD = Infinity
      for (const e of enemies) {
        const d = (e.x - x) * (e.x - x) + (e.y - y) * (e.y - y)
        if (d < bestD) { bestD = d; best = e }
      }
      return best
    }

    function fireVolley() {
      const target = nearestEnemy(hero.x, hero.y)
      if (!target) return
      const base = Math.atan2(target.y - hero.y, target.x - hero.x)
      const n = hero.projCount
      const spread = 0.18
      for (let i = 0; i < n; i++) {
        if (projectiles.length >= MAX_PROJECTILES) break
        // fan the extra projectiles around the aim line
        const off = n === 1 ? 0 : (i - (n - 1) / 2) * spread
        const a = base + off
        projectiles.push({
          x: hero.x, y: hero.y,
          vx: Math.cos(a) * hero.projSpeed,
          vy: Math.sin(a) * hero.projSpeed,
          r: 4,
          dmg: hero.dmg,
          life: 1.1,
        })
      }
    }

    function spawnGem(x, y, amount) {
      if (gems.length >= MAX_GEMS) return
      gems.push({ x, y, amount, r: 4, wob: Math.random() * Math.PI * 2 })
    }

    function burst(x, y, color, count) {
      for (let i = 0; i < count; i++) {
        if (particles.length > 200) break
        const a = rand(0, Math.PI * 2), sp = rand(40, 160)
        particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.25, 0.5), color })
      }
    }

    function killEnemy(idx) {
      const e = enemies[idx]
      spawnGem(e.x, e.y, e.xp)
      burst(e.x, e.y, e.color, 6)
      enemies.splice(idx, 1)
      kills++
    }

    // ---------- upgrades ----------
    const UPGRADES = [
      { name: '+25% DAMAGE', apply: () => { hero.dmg *= 1.25 }, color: PINK },
      { name: '+18% FIRE RATE', apply: () => { hero.fireRate = Math.max(0.12, hero.fireRate * 0.82) }, color: ORANGE },
      { name: '+1 PROJECTILE', apply: () => { hero.projCount = Math.min(7, hero.projCount + 1) }, color: CYAN },
      { name: '+12% MOVE SPEED', apply: () => { hero.speed *= 1.12 }, color: GREEN },
      { name: '+25 MAX HP', apply: () => { hero.maxHp += 25; hero.hp += 25 }, color: PINK },
      { name: '+40% PICKUP', apply: () => { hero.pickupRange *= 1.4 }, color: GREEN },
      { name: '+15% PROJ SPEED', apply: () => { hero.projSpeed *= 1.15 }, color: PURPLE },
      { name: 'HEAL 40 HP', apply: () => { hero.hp = Math.min(hero.maxHp, hero.hp + 40) }, color: GREEN },
    ]

    function rollDraft() {
      const pool = UPGRADES.slice()
      const picks = []
      for (let i = 0; i < 3 && pool.length; i++) {
        const idx = Math.floor(Math.random() * pool.length)
        picks.push(pool.splice(idx, 1)[0])
      }
      draft = picks
    }

    function levelUp() {
      level++
      xp -= xpNeed
      xpNeed = xpForLevel(level)
      rollDraft()
      state = 'levelup'
    }

    function chooseUpgrade(i) {
      if (!draft || !draft[i]) return
      draft[i].apply()
      draft = null
      state = 'playing'
      fireTimer = Math.min(fireTimer, hero.fireRate)
    }

    // autoplay picks a sensible upgrade: priority list by current need.
    function autoChooseUpgrade() {
      if (!draft) return
      const want = ['+1 PROJECTILE', '+18% FIRE RATE', '+25% DAMAGE', '+25 MAX HP', '+12% MOVE SPEED', '+15% PROJ SPEED', '+40% PICKUP', 'HEAL 40 HP']
      // if low HP, heal first
      if (hero.hp < hero.maxHp * 0.45) {
        const hi = draft.findIndex((u) => u.name === 'HEAL 40 HP')
        if (hi >= 0) { chooseUpgrade(hi); return }
      }
      for (const name of want) {
        const i = draft.findIndex((u) => u.name === name)
        if (i >= 0) { chooseUpgrade(i); return }
      }
      chooseUpgrade(0)
    }

    // ---------- autoplay bot ----------
    // Drives the game's own `keys` each frame. Kite toward the largest open
    // space / away from the nearest enemy cluster; auto-attack does the killing.
    function botMove(dt) {
      if (state === 'levelup') { autoChooseUpgrade(); return }
      if (state !== 'playing') return
      keys.up = keys.down = keys.left = keys.right = false

      // accumulate a repulsion vector from nearby enemies (cluster avoidance),
      // weighted by closeness so the densest threat dominates.
      let fx = 0, fy = 0, threat = 0
      let nearD = Infinity
      for (const e of enemies) {
        const dx = hero.x - e.x, dy = hero.y - e.y
        const d = Math.hypot(dx, dy) || 0.001
        if (d < nearD) nearD = d
        const w = 1 / (d * d)
        fx += (dx / d) * w
        fy += (dy / d) * w
        if (d < 140) threat += 1
      }

      // normalize enemy repulsion so it's comparable to the center pull below
      const rmag = Math.hypot(fx, fy) || 1
      fx /= rmag; fy /= rmag

      // pull toward arena center so the bot doesn't pin itself in a corner;
      // strength scales with distance from center (stronger near the walls).
      const cx = W / 2 - hero.x, cy = H / 2 - hero.y
      const cd = Math.hypot(cx, cy) || 1
      const centerWeight = Math.min(1.2, cd / 160)
      fx += (cx / cd) * centerWeight
      fy += (cy / cd) * centerWeight

      // also drift toward the nearest XP gem when it's safe-ish, to keep leveling
      if (nearD > 90 && gems.length) {
        let g = null, gd = Infinity
        for (const gm of gems) {
          const d = (gm.x - hero.x) ** 2 + (gm.y - hero.y) ** 2
          if (d < gd) { gd = d; g = gm }
        }
        if (g) {
          const gx = g.x - hero.x, gy = g.y - hero.y
          const gl = Math.hypot(gx, gy) || 1
          fx += (gx / gl) * 0.5
          fy += (gy / gl) * 0.5
        }
      }

      if (!wantWin) {
        // sloppy losing round: barely move, let the swarm collapse on the hero.
        return
      }

      const mag = Math.hypot(fx, fy)
      if (mag < 1e-6) return
      const ux = fx / mag, uy = fy / mag
      if (uy < -0.35) keys.up = true
      else if (uy > 0.35) keys.down = true
      if (ux < -0.35) keys.left = true
      else if (ux > 0.35) keys.right = true
    }

    function update(dt) {
      // particles always animate
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]
        p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt
        if (p.life <= 0) particles.splice(i, 1)
      }

      if (auto) botMove(dt)
      if (state !== 'playing') return

      time += dt

      // --- hero movement ---
      let mx = 0, my = 0
      if (keys.left) mx -= 1
      if (keys.right) mx += 1
      if (keys.up) my -= 1
      if (keys.down) my += 1
      if (mx || my) {
        const m = Math.hypot(mx, my)
        hero.x += (mx / m) * hero.speed * dt
        hero.y += (my / m) * hero.speed * dt
        hero.x = Math.max(HERO_R, Math.min(W - HERO_R, hero.x))
        hero.y = Math.max(HERO_R, Math.min(H - HERO_R, hero.y))
      }
      if (hero.invuln > 0) hero.invuln = Math.max(0, hero.invuln - dt)

      // --- auto attack ---
      fireTimer -= dt
      if (fireTimer <= 0) {
        fireVolley()
        fireTimer = hero.fireRate
      }

      // --- spawn enemies ---
      spawnTimer -= dt
      const interval = 1 / spawnRate()
      while (spawnTimer <= 0) {
        if (enemies.length < maxAlive()) enemies.push(makeEnemy())
        spawnTimer += interval
      }

      // --- projectiles ---
      for (let i = projectiles.length - 1; i >= 0; i--) {
        const p = projectiles[i]
        p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt
        if (p.life <= 0 || p.x < -30 || p.x > W + 30 || p.y < -30 || p.y > H + 30) {
          projectiles.splice(i, 1)
        }
      }

      // --- enemies chase + separation wobble ---
      for (const e of enemies) {
        e.wob += dt * 6
        const dx = hero.x - e.x, dy = hero.y - e.y
        const d = Math.hypot(dx, dy) || 1
        e.x += (dx / d) * e.speed * dt
        e.y += (dy / d) * e.speed * dt
      }

      // --- projectile vs enemy ---
      for (let i = projectiles.length - 1; i >= 0; i--) {
        const p = projectiles[i]
        for (let j = enemies.length - 1; j >= 0; j--) {
          const e = enemies[j]
          const rr = p.r + e.r
          if ((p.x - e.x) ** 2 + (p.y - e.y) ** 2 < rr * rr) {
            e.hp -= p.dmg
            burst(p.x, p.y, '#fff', 2)
            projectiles.splice(i, 1)
            if (e.hp <= 0) killEnemy(j)
            break
          }
        }
      }

      // --- enemy vs hero (contact damage) ---
      for (const e of enemies) {
        const rr = e.r + HERO_R
        if ((e.x - hero.x) ** 2 + (e.y - hero.y) ** 2 < rr * rr) {
          if (hero.invuln <= 0) {
            hero.hp -= e.dmg
            hero.invuln = 0.5
            burst(hero.x, hero.y, PINK, 5)
            if (hero.hp <= 0) { hero.hp = 0; gameOver(); return }
          }
        }
      }

      // --- gems: attract within pickup range, collect on contact ---
      for (let i = gems.length - 1; i >= 0; i--) {
        const g = gems[i]
        g.wob += dt * 5
        const dx = hero.x - g.x, dy = hero.y - g.y
        const d = Math.hypot(dx, dy) || 1
        if (d < hero.pickupRange) {
          const pull = 220 + (hero.pickupRange - d) * 4
          g.x += (dx / d) * pull * dt
          g.y += (dy / d) * pull * dt
        }
        if (d < HERO_R + 6) {
          xp += g.amount
          gems.splice(i, 1)
          if (xp >= xpNeed) { levelUp(); }
        }
      }

      // autoplay: end the session cleanly once it reaches the win threshold
      if (auto && wantWin && time >= WIN_THRESHOLD && !recorded) {
        winSession()
      }
    }

    function gameOver() {
      state = 'over'
      const score = Math.floor(time)
      if (score > best) { best = score; localStorage.setItem(BEST_KEY, String(best)) }
      if (auto && !recorded) {
        recorded = true
        recordAutoplayResult('survivors', time >= WIN_THRESHOLD)
      }
    }

    function winSession() {
      state = 'over'
      const score = Math.floor(time)
      if (score > best) { best = score; localStorage.setItem(BEST_KEY, String(best)) }
      recorded = true
      recordAutoplayResult('survivors', true)
    }

    // ---------- input ----------
    function startOrRestart() {
      if (state === 'ready' || state === 'over') newGame()
    }
    function onKeyDown(e) {
      const k = e.code
      if (k === 'ArrowUp' || k === 'KeyW') { keys.up = true; e.preventDefault() }
      else if (k === 'ArrowDown' || k === 'KeyS') { keys.down = true; e.preventDefault() }
      else if (k === 'ArrowLeft' || k === 'KeyA') { keys.left = true; e.preventDefault() }
      else if (k === 'ArrowRight' || k === 'KeyD') { keys.right = true; e.preventDefault() }
      else if (k === 'Digit1') { if (state === 'levelup') chooseUpgrade(0) }
      else if (k === 'Digit2') { if (state === 'levelup') chooseUpgrade(1) }
      else if (k === 'Digit3') { if (state === 'levelup') chooseUpgrade(2) }
      else if (k === 'Space') {
        e.preventDefault()
        startOrRestart()
      }
    }
    function onKeyUp(e) {
      const k = e.code
      if (k === 'ArrowUp' || k === 'KeyW') keys.up = false
      else if (k === 'ArrowDown' || k === 'KeyS') keys.down = false
      else if (k === 'ArrowLeft' || k === 'KeyA') keys.left = false
      else if (k === 'ArrowRight' || k === 'KeyD') keys.right = false
    }
    function onPointer(e) {
      if (state === 'levelup') {
        // tap a card to pick it
        const rect = canvas.getBoundingClientRect()
        const px = (e.clientX - rect.left) * (W / rect.width)
        const py = (e.clientY - rect.top) * (H / rect.height)
        const cardW = 170, gap = 20, cardH = 150
        const totalW = cardW * 3 + gap * 2
        const x0 = (W - totalW) / 2
        const y0 = H / 2 - cardH / 2
        for (let i = 0; i < 3; i++) {
          const cx = x0 + i * (cardW + gap)
          if (px >= cx && px <= cx + cardW && py >= y0 && py <= y0 + cardH) {
            chooseUpgrade(i); return
          }
        }
        return
      }
      startOrRestart()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    canvas.addEventListener('pointerdown', onPointer)

    // ---------- drawing ----------
    function sparkle(x, y, s) {
      ctx.strokeStyle = PINK; ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(x - s, y); ctx.lineTo(x + s, y); ctx.moveTo(x, y - s); ctx.lineTo(x, y + s); ctx.stroke()
    }

    function drawGrid() {
      ctx.strokeStyle = 'rgba(177,74,237,0.06)'
      ctx.lineWidth = 1
      const step = 40
      ctx.beginPath()
      for (let x = 0; x <= W; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, H) }
      for (let y = 0; y <= H; y += step) { ctx.moveTo(0, y); ctx.lineTo(W, y) }
      ctx.stroke()
    }

    function drawHero() {
      const blink = hero.invuln > 0 && Math.floor(hero.invuln * 20) % 2 === 0
      if (blink) return
      ctx.save()
      ctx.shadowColor = PINK; ctx.shadowBlur = 18
      ctx.fillStyle = PINK
      ctx.beginPath(); ctx.arc(hero.x, hero.y, HERO_R, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#fff'
      ctx.beginPath(); ctx.arc(hero.x, hero.y, HERO_R * 0.4, 0, Math.PI * 2); ctx.fill()
      ctx.shadowBlur = 0
      ctx.restore()
    }

    function drawEnemy(e) {
      ctx.save()
      ctx.shadowColor = e.color; ctx.shadowBlur = 12
      ctx.fillStyle = e.color
      const wob = Math.sin(e.wob) * 1.5
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r + wob, 0, Math.PI * 2); ctx.fill()
      ctx.shadowBlur = 0
      // hp pip for damaged enemies
      if (e.hp < e.maxHp) {
        ctx.fillStyle = 'rgba(0,0,0,0.45)'
        ctx.fillRect(e.x - e.r, e.y - e.r - 6, e.r * 2, 3)
        ctx.fillStyle = GREEN
        ctx.fillRect(e.x - e.r, e.y - e.r - 6, e.r * 2 * (e.hp / e.maxHp), 3)
      }
      ctx.restore()
    }

    function draw() {
      ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, W, H)
      drawGrid()
      sparkle(24, 24, 5); sparkle(W - 24, H - 24, 4)

      // gems
      ctx.save()
      ctx.shadowColor = GREEN; ctx.shadowBlur = 10
      ctx.fillStyle = GREEN
      for (const g of gems) {
        const s = g.r + Math.sin(g.wob) * 0.8
        ctx.beginPath()
        ctx.moveTo(g.x, g.y - s); ctx.lineTo(g.x + s, g.y); ctx.lineTo(g.x, g.y + s); ctx.lineTo(g.x - s, g.y)
        ctx.closePath(); ctx.fill()
      }
      ctx.shadowBlur = 0
      ctx.restore()

      // enemies
      for (const e of enemies) drawEnemy(e)

      // projectiles
      ctx.save()
      ctx.shadowColor = '#fff'; ctx.shadowBlur = 12
      ctx.fillStyle = '#fff'
      for (const p of projectiles) {
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill()
      }
      ctx.shadowBlur = 0
      ctx.restore()

      // particles
      for (const p of particles) {
        ctx.globalAlpha = Math.max(0, p.life * 2)
        ctx.fillStyle = p.color
        ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3)
      }
      ctx.globalAlpha = 1

      // hero
      if (state !== 'ready') drawHero()

      drawHUD()

      if (state === 'ready') overlay('SURVIVORS', 'space / tap to start')
      else if (state === 'over') {
        const won = auto && time >= WIN_THRESHOLD
        overlay(won ? 'SURVIVED' : 'GAME OVER', 'space / tap to play again')
      }
      else if (state === 'levelup') drawLevelUp()
    }

    function label(text, x, y) {
      ctx.fillStyle = PINK
      ctx.font = '700 11px system-ui, sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText(text, x, y)
      const w = ctx.measureText(text).width
      ctx.fillRect(x, y + 4, w, 2)
    }

    function drawHUD() {
      // TIME
      const t = Math.floor(time)
      const mm = String(Math.floor(t / 60)).padStart(2, '0')
      const ss = String(t % 60).padStart(2, '0')
      label('TIME', 20, 26)
      ctx.fillStyle = '#fff'; ctx.font = '800 20px system-ui, sans-serif'; ctx.textAlign = 'left'
      ctx.fillText(`${mm}:${ss}`, 20, 50)

      // LEVEL
      label('LEVEL', 110, 26)
      ctx.fillStyle = '#fff'; ctx.font = '800 20px system-ui, sans-serif'
      ctx.fillText(String(level), 110, 50)

      // KILLS
      label('KILLS', 180, 26)
      ctx.fillStyle = '#fff'; ctx.font = '800 20px system-ui, sans-serif'
      ctx.fillText(String(kills), 180, 50)

      // BEST (top-right)
      ctx.textAlign = 'right'
      ctx.fillStyle = PINK; ctx.font = '700 11px system-ui, sans-serif'
      ctx.fillText('BEST', W - 20, 26)
      const bw = ctx.measureText('BEST').width
      ctx.fillRect(W - 20 - bw, 30, bw, 2)
      ctx.fillStyle = '#fff'; ctx.font = '800 20px system-ui, sans-serif'
      ctx.fillText(`${best}s`, W - 20, 50)
      ctx.textAlign = 'left'

      // HP bar (bottom)
      const barW = W - 40, barH = 14, bx = 20, by = H - 40
      ctx.fillStyle = 'rgba(255,255,255,0.08)'
      ctx.fillRect(bx, by, barW, barH)
      const hpFrac = hero ? Math.max(0, hero.hp / hero.maxHp) : 0
      ctx.fillStyle = hpFrac > 0.35 ? PINK : ORANGE
      ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 10
      ctx.fillRect(bx, by, barW * hpFrac, barH)
      ctx.shadowBlur = 0
      ctx.fillStyle = '#fff'; ctx.font = '700 10px system-ui, sans-serif'; ctx.textAlign = 'center'
      ctx.fillText(`HP ${Math.ceil(hero ? hero.hp : 0)} / ${hero ? hero.maxHp : 0}`, W / 2, by + 11)
      ctx.textAlign = 'left'

      // XP bar (above HP)
      const xby = H - 20
      ctx.fillStyle = 'rgba(255,255,255,0.08)'
      ctx.fillRect(bx, xby, barW, 6)
      const xpFrac = Math.max(0, Math.min(1, xp / xpNeed))
      ctx.fillStyle = CYAN
      ctx.shadowColor = CYAN; ctx.shadowBlur = 8
      ctx.fillRect(bx, xby, barW * xpFrac, 6)
      ctx.shadowBlur = 0

      if (auto) {
        ctx.fillStyle = '#8a93ad'; ctx.font = '600 10px system-ui, sans-serif'; ctx.textAlign = 'center'
        ctx.fillText(wantWin ? 'AUTOPLAY' : 'AUTOPLAY (sloppy)', W / 2, 50)
        ctx.textAlign = 'left'
      }
    }

    function drawLevelUp() {
      ctx.fillStyle = 'rgba(10,10,10,0.82)'; ctx.fillRect(0, 0, W, H)
      ctx.textAlign = 'center'
      ctx.fillStyle = PINK; ctx.font = '800 34px system-ui, sans-serif'
      ctx.shadowColor = PINK; ctx.shadowBlur = 16
      ctx.fillText('LEVEL UP', W / 2, H / 2 - 110)
      ctx.shadowBlur = 0
      ctx.fillStyle = PINK; ctx.fillRect(W / 2 - 70, H / 2 - 94, 140, 4)

      const cardW = 170, gap = 20, cardH = 150
      const totalW = cardW * 3 + gap * 2
      const x0 = (W - totalW) / 2
      const y0 = H / 2 - cardH / 2
      for (let i = 0; i < 3 && draft && i < draft.length; i++) {
        const u = draft[i]
        const cx = x0 + i * (cardW + gap)
        ctx.fillStyle = 'rgba(20,20,28,0.9)'
        ctx.fillRect(cx, y0, cardW, cardH)
        ctx.strokeStyle = u.color; ctx.lineWidth = 2
        ctx.shadowColor = u.color; ctx.shadowBlur = 14
        ctx.strokeRect(cx, y0, cardW, cardH)
        ctx.shadowBlur = 0
        // sparkle corners
        sparkleAt(cx + 8, y0 + 8, u.color)
        sparkleAt(cx + cardW - 8, y0 + cardH - 8, u.color)
        ctx.fillStyle = u.color; ctx.font = '800 15px system-ui, sans-serif'; ctx.textAlign = 'center'
        wrapText(u.name, cx + cardW / 2, y0 + cardH / 2 - 6, cardW - 24, 18)
        ctx.fillStyle = '#8a93ad'; ctx.font = '600 11px system-ui, sans-serif'
        ctx.fillText(`[${i + 1}] / tap`, cx + cardW / 2, y0 + cardH - 16)
      }
      ctx.textAlign = 'left'
    }

    function sparkleAt(x, y, color) {
      ctx.strokeStyle = color; ctx.lineWidth = 1.5
      ctx.beginPath(); ctx.moveTo(x - 4, y); ctx.lineTo(x + 4, y); ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4); ctx.stroke()
    }

    function wrapText(text, x, y, maxW, lh) {
      const words = text.split(' ')
      let line = '', lines = []
      for (const w of words) {
        const test = line ? line + ' ' + w : w
        if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w }
        else line = test
      }
      if (line) lines.push(line)
      const startY = y - ((lines.length - 1) * lh) / 2
      lines.forEach((ln, i) => ctx.fillText(ln, x, startY + i * lh))
    }

    function overlay(title, sub) {
      ctx.fillStyle = 'rgba(10,10,10,0.74)'; ctx.fillRect(0, H / 2 - 90, W, 180)
      ctx.textAlign = 'center'
      ctx.fillStyle = PINK; ctx.font = '800 44px system-ui, sans-serif'
      ctx.shadowColor = PINK; ctx.shadowBlur = 18
      ctx.fillText(title, W / 2, H / 2 - 6)
      ctx.shadowBlur = 0
      ctx.fillStyle = PINK; ctx.fillRect(W / 2 - 80, H / 2 + 14, 160, 4)
      ctx.fillStyle = '#fff'; ctx.font = '600 14px system-ui, sans-serif'
      ctx.fillText(sub, W / 2, H / 2 + 46)
      ctx.fillStyle = '#8a93ad'; ctx.font = '600 11px system-ui, sans-serif'
      ctx.fillText('WASD / arrows move  •  auto-fire  •  survive ' + WIN_THRESHOLD + 's', W / 2, H / 2 + 70)
      ctx.textAlign = 'left'
    }

    function loop(now) {
      let dt = (now - last) / 1000; last = now
      if (dt > 0.05) dt = 0.05
      else if (dt < 0) dt = 0 // guard against clock skew (e.g. first frame / tab switch)
      if (auto) {
        if (state === 'ready') {
          wantWin = shouldAutoWin('survivors')
          newGame()
        } else if (state === 'over') {
          if (autoRestartAt === 0) autoRestartAt = now + 1500
          else if (now >= autoRestartAt) {
            autoRestartAt = 0
            wantWin = shouldAutoWin('survivors')
            newGame()
          }
        }
      }
      update(dt)
      draw()
      raf = requestAnimationFrame(loop)
    }

    readyState()
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      canvas.removeEventListener('pointerdown', onPointer)
    }
  }, [])

  return (
    <canvas ref={canvasRef} width={W} height={H} className="survivors-canvas" aria-label="Survivors game" />
  )
}
