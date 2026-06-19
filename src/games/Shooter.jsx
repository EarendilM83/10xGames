import { useEffect, useRef } from 'react'
import { isAutoplay, shouldAutoWin, recordAutoplayResult } from '../autoplay.js'

// Vertical-scrolling space shooter (Galaga-ish) on canvas, 10x neon style.
// Player ship at bottom, enemy formations that dive and shoot, power-ups, bosses.
const W = 480
const H = 640

const PLAYER_W = 30
const PLAYER_H = 26
const PLAYER_Y = H - 64
const PLAYER_SPEED = 340         // px/s horizontal
const PLAYER_VSPEED = 240        // px/s vertical (limited band near bottom)
const PLAYER_MIN_Y = H - 200
const PLAYER_MAX_Y = H - 40

const BULLET_SPEED = 620         // player bullets, upward
const ENEMY_BULLET_SPEED = 230   // enemy bullets, downward
const FIRE_COOLDOWN = 0.22       // base s between player shots
const RAPID_COOLDOWN = 0.10

const WIN_WAVE = 5               // autoplay win = reach this wave without dying out

// entity caps so the sim never lags
const MAX_BULLETS = 60
const MAX_EBULLETS = 80
const MAX_PARTICLES = 220
const MAX_ENEMIES = 60
const MAX_STARS = 90
const MAX_POWERUPS = 6

const PINK = '#ff2d6f'
const MUTED = '#8a93ad'
const ENEMY_COLORS = ['#2de2e6', '#b14aed', '#ff8a1e']
const ENEMY_SCORE = [30, 40, 50]

const BEST_KEY = '10xgames.shooter.best'

export default function Shooter() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')

    const auto = isAutoplay('shooter')
    let wantWin = auto ? shouldAutoWin('shooter') : false
    let restartTimer = 0
    let resultRecorded = false

    let player, bullets, enemies, ebullets, particles, stars, powerups, boss
    let score, lives, wave, state, best
    let fireTimer, powerTimer, powerKind, shieldTimer, spawnTimer, formationPhase
    const keys = { left: false, right: false, up: false, down: false, fire: false }
    let last = performance.now(), raf = 0

    best = Number(localStorage.getItem(BEST_KEY)) || 0

    function rand(a, b) { return a + Math.random() * (b - a) }

    function makeStars() {
      const arr = []
      for (let i = 0; i < MAX_STARS; i++) {
        arr.push({ x: rand(0, W), y: rand(0, H), s: rand(0.6, 2.2), v: rand(20, 90) })
      }
      return arr
    }

    // Build a Galaga-style grid formation. Enemies fly in from the top, then settle
    // into formation slots and periodically dive at the player.
    function spawnWave(w) {
      enemies = []
      ebullets = []
      boss = null
      const isBoss = (w % 5) === 0
      if (isBoss) {
        boss = {
          x: W / 2, y: -60, slotY: 96,
          w: 120, h: 56, hp: 60 + w * 12, maxHp: 60 + w * 12,
          t: 0, fireT: 1.2, entering: true, color: PINK,
        }
        return
      }
      const rows = Math.min(3 + Math.floor(w / 2), 5)
      const cols = 7
      const gapX = 50
      const gapY = 42
      const left = (W - (cols - 1) * gapX) / 2
      const top = 84
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (enemies.length >= MAX_ENEMIES) break
          const tier = r < 1 ? 2 : r < 3 ? 1 : 0
          enemies.push({
            slotX: left + c * gapX,
            slotY: top + r * gapY,
            // enter from off-screen along a curve
            x: left + c * gapX + (c % 2 === 0 ? -W : W),
            y: -40 - r * 24,
            tier,
            color: ENEMY_COLORS[tier],
            value: ENEMY_SCORE[tier],
            hp: tier === 2 ? 2 : 1,
            entering: true,
            enterDelay: (r * cols + c) * 0.05,
            diving: false,
            diveT: 0,
            dx: 0, dy: 0,
            fireBias: tier + 1,
            alive: true,
          })
        }
      }
    }

    function newGame() {
      score = 0
      lives = 3
      wave = 1
      player = { x: W / 2, y: PLAYER_MAX_Y - 60 }
      bullets = []
      particles = []
      powerups = []
      stars = makeStars()
      fireTimer = 0
      powerTimer = 0
      powerKind = null
      shieldTimer = 0
      spawnTimer = 0
      formationPhase = 0
      resultRecorded = false
      spawnWave(wave)
      state = 'ready'
    }

    function commitBest() {
      if (score > best) { best = score; localStorage.setItem(BEST_KEY, String(best)) }
    }

    function burst(x, y, color, n) {
      for (let i = 0; i < n; i++) {
        if (particles.length >= MAX_PARTICLES) break
        const a = rand(0, Math.PI * 2)
        const sp = rand(40, 220)
        particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.3, 0.7), max: 0.7, color })
      }
    }

    function loseLife() {
      if (shieldTimer > 0) return
      lives--
      burst(player.x, player.y, PINK, 26)
      if (lives <= 0) {
        state = 'over'
        commitBest()
        restartTimer = 1.4
      } else {
        player.x = W / 2
        player.y = PLAYER_MAX_Y - 60
        shieldTimer = 1.4      // brief respawn invulnerability
        ebullets = []
      }
    }

    function fire() {
      if (fireTimer > 0) return
      const rapid = powerKind === 'rapid' && powerTimer > 0
      const spread = powerKind === 'spread' && powerTimer > 0
      const bx = player.x, by = player.y - PLAYER_H / 2
      if (spread) {
        for (const ang of [-0.28, 0, 0.28]) {
          if (bullets.length >= MAX_BULLETS) break
          bullets.push({ x: bx, y: by, vx: Math.sin(ang) * BULLET_SPEED, vy: -Math.cos(ang) * BULLET_SPEED })
        }
      } else if (bullets.length < MAX_BULLETS) {
        bullets.push({ x: bx, y: by, vx: 0, vy: -BULLET_SPEED })
      }
      fireTimer = rapid ? RAPID_COOLDOWN : FIRE_COOLDOWN
    }

    function spawnPowerup(x, y) {
      if (powerups.length >= MAX_POWERUPS) return
      const kinds = ['spread', 'rapid', 'shield']
      const kind = kinds[(Math.random() * kinds.length) | 0]
      powerups.push({ x, y, kind, vy: 90 })
    }

    function applyPowerup(kind) {
      if (kind === 'shield') { shieldTimer = 6 }
      else { powerKind = kind; powerTimer = 8 }
    }

    function nextWave() {
      commitBest()
      wave++
      formationPhase = 0
      spawnTimer = 0.4
      spawnWave(wave)
    }

    // ---------- autoplay bot ----------
    function botUpdate(dt) {
      if (state === 'ready') { state = 'playing'; wantWin = shouldAutoWin('shooter'); return }
      if (state === 'over') {
        if (!resultRecorded) {
          recordAutoplayResult('shooter', wave >= WIN_WAVE)
          resultRecorded = true
        }
        restartTimer -= dt
        if (restartTimer <= 0) { newGame(); state = 'playing' }
        return
      }
      if (state !== 'playing') return

      // auto-fire always
      keys.fire = true

      // ---- threat assessment: find the most imminent incoming danger over our column ----
      let threat = null, threatTime = Infinity
      const px = player.x
      const margin = 18
      if (wantWin) {
        for (const eb of ebullets) {
          if (eb.vy <= 0) continue
          if (eb.y > player.y) continue
          const tHit = (player.y - eb.y) / eb.vy
          const impactX = eb.x + eb.vx * tHit
          if (Math.abs(impactX - px) < PLAYER_W / 2 + margin && tHit < threatTime) {
            threatTime = tHit; threat = { x: impactX }
          }
        }
        // diving enemies that are close also count as threats
        for (const e of enemies) {
          if (!e.alive || !e.diving) continue
          if (e.y > player.y + 30) continue
          const dyy = player.y - e.y
          if (dyy < 0) continue
          const tHit = dyy / Math.max(60, e.dy)
          const impactX = e.x + e.dx * tHit
          if (Math.abs(impactX - px) < PLAYER_W / 2 + margin && tHit < threatTime) {
            threatTime = tHit; threat = { x: impactX }
          }
        }
        // boss bullets handled above (they live in ebullets)
      }

      // ---- choose target column: nearest-in-x live enemy / boss ----
      let targetX = px
      if (boss && !boss.entering) {
        targetX = boss.x
      } else {
        let bestDx = Infinity
        for (const e of enemies) {
          if (!e.alive) continue
          const dx = Math.abs(e.x - px)
          if (dx < bestDx) { bestDx = dx; targetX = e.x }
        }
      }

      let desired = px
      if (wantWin) {
        if (threat && threatTime < 0.7) {
          // steer toward the safer side, away from the threat impact point
          const room = 60
          const goRight = threat.x < W / 2
          desired = goRight ? Math.min(W - 24, threat.x + room) : Math.max(24, threat.x - room)
        } else {
          desired = targetX
        }
      } else {
        // sloppy: drift toward danger, never dodge
        desired = targetX
        if (threat) desired = threat.x
      }

      // smooth proportional horizontal movement
      const diff = desired - px
      const maxStep = PLAYER_SPEED * dt
      let step = diff * Math.min(1, 13 * dt)
      if (step > maxStep) step = maxStep
      else if (step < -maxStep) step = -maxStep
      if (Math.abs(diff) > 0.5) player.x += step
      player.x = Math.max(16, Math.min(W - 16, player.x))

      // keep a steady vertical position low on the field
      const wantY = wantWin ? PLAYER_MAX_Y - 50 : PLAYER_MAX_Y - 50
      player.y += (wantY - player.y) * Math.min(1, 6 * dt)
      player.y = Math.max(PLAYER_MIN_Y, Math.min(PLAYER_MAX_Y, player.y))
    }

    // ---------- update ----------
    function update(dt) {
      // stars always scroll (nice on menus too)
      for (const s of stars) {
        s.y += s.v * dt
        if (s.y > H) { s.y = 0; s.x = rand(0, W) }
      }

      if (auto) botUpdate(dt)

      // manual movement
      if (state === 'playing' && !auto) {
        if (keys.left) player.x -= PLAYER_SPEED * dt
        if (keys.right) player.x += PLAYER_SPEED * dt
        if (keys.up) player.y -= PLAYER_VSPEED * dt
        if (keys.down) player.y += PLAYER_VSPEED * dt
        player.x = Math.max(16, Math.min(W - 16, player.x))
        player.y = Math.max(PLAYER_MIN_Y, Math.min(PLAYER_MAX_Y, player.y))
      }

      if (fireTimer > 0) fireTimer -= dt
      if (powerTimer > 0) { powerTimer -= dt; if (powerTimer <= 0) powerKind = null }
      if (shieldTimer > 0) shieldTimer -= dt

      // update particles regardless of state (so explosions finish on game over)
      for (const p of particles) {
        p.x += p.vx * dt; p.y += p.vy * dt
        p.vx *= 0.94; p.vy *= 0.94
        p.life -= dt
      }
      particles = particles.filter((p) => p.life > 0)

      if (state !== 'playing') return

      // fire (manual or auto sets keys.fire)
      if (keys.fire) fire()

      formationPhase += dt

      // -------- player bullets --------
      for (const b of bullets) { b.x += b.vx * dt; b.y += b.vy * dt }

      // -------- power-ups fall --------
      for (const pu of powerups) pu.y += pu.vy * dt

      // -------- boss --------
      if (boss) {
        boss.t += dt
        if (boss.entering) {
          boss.y += (boss.slotY - boss.y) * Math.min(1, 2.4 * dt)
          if (Math.abs(boss.y - boss.slotY) < 1) boss.entering = false
        } else {
          boss.x = W / 2 + Math.sin(boss.t * 0.9) * (W / 2 - 80)
          boss.fireT -= dt
          if (boss.fireT <= 0) {
            // fan of bullets aimed roughly downward; tighter when we want a winnable round
            const spreadN = wantWin ? 3 : 5
            const aim = Math.atan2(player.y - boss.y, player.x - boss.x)
            for (let i = 0; i < spreadN; i++) {
              if (ebullets.length >= MAX_EBULLETS) break
              const ang = aim + (i - (spreadN - 1) / 2) * 0.22
              ebullets.push({ x: boss.x, y: boss.y + boss.h / 2, vx: Math.cos(ang) * ENEMY_BULLET_SPEED, vy: Math.sin(ang) * ENEMY_BULLET_SPEED })
            }
            boss.fireT = wantWin ? 1.4 : 0.9
          }
        }
        // bullets vs boss
        for (const b of bullets) {
          if (b.dead) continue
          if (Math.abs(b.x - boss.x) < boss.w / 2 && Math.abs(b.y - boss.y) < boss.h / 2) {
            b.dead = true
            boss.hp -= 1
            burst(b.x, b.y, boss.color, 4)
          }
        }
        if (boss.hp <= 0) {
          burst(boss.x, boss.y, PINK, 60)
          score += 500
          boss = null
          nextWave()
        }
      }

      // -------- enemies: enter formation, breathe, dive, shoot --------
      const aim = formationPhase
      const sway = Math.sin(aim * 1.3) * 14
      const diveChance = 0.18 + wave * 0.04
      const fireChance = (wantWin ? 0.22 : 0.5) + wave * 0.03
      for (const e of enemies) {
        if (!e.alive) continue
        if (e.entering) {
          if (e.enterDelay > 0) { e.enterDelay -= dt; continue }
          e.x += (e.slotX - e.x) * Math.min(1, 3 * dt)
          e.y += (e.slotY - e.y) * Math.min(1, 3 * dt)
          if (Math.abs(e.x - e.slotX) < 1 && Math.abs(e.y - e.slotY) < 1) e.entering = false
        } else if (e.diving) {
          e.diveT += dt
          // curving dive toward the player, then loop back to top
          e.dx += (player.x - e.x) * 0.6 * dt
          e.dx = Math.max(-160, Math.min(160, e.dx))
          e.dy = 150 + e.diveT * 40
          e.x += e.dx * dt
          e.y += e.dy * dt
          if (e.y > H + 30) {
            // wrap back to formation slot from top
            e.y = -30
            e.diving = false
            e.diveT = 0
            e.dx = 0; e.dy = 0
            e.entering = true
          }
          // dive shooting
          if (Math.random() < fireChance * dt * 2 && ebullets.length < MAX_EBULLETS) {
            ebullets.push({ x: e.x, y: e.y + 10, vx: 0, vy: ENEMY_BULLET_SPEED })
          }
        } else {
          // settled: gentle sway + occasional dive / fire
          e.x = e.slotX + sway
          if (Math.random() < diveChance * dt) { e.diving = true; e.diveT = 0; e.dx = 0 }
          if (Math.random() < fireChance * 0.5 * dt && ebullets.length < MAX_EBULLETS) {
            ebullets.push({ x: e.x, y: e.y + 10, vx: 0, vy: ENEMY_BULLET_SPEED })
          }
        }
      }

      // -------- enemy bullets fall --------
      for (const eb of ebullets) { eb.x += eb.vx * dt; eb.y += eb.vy * dt }

      // -------- collisions: player bullets vs enemies --------
      for (const b of bullets) {
        if (b.dead) continue
        for (const e of enemies) {
          if (!e.alive) continue
          if (Math.abs(b.x - e.x) < 16 && Math.abs(b.y - e.y) < 16) {
            b.dead = true
            e.hp -= 1
            if (e.hp <= 0) {
              e.alive = false
              score += e.value
              burst(e.x, e.y, e.color, 16)
              if (Math.random() < 0.12) spawnPowerup(e.x, e.y)
            } else {
              burst(b.x, b.y, e.color, 4)
            }
            break
          }
        }
      }

      // -------- collisions: enemy bullets vs player --------
      const phw = PLAYER_W / 2, phh = PLAYER_H / 2
      for (const eb of ebullets) {
        if (eb.dead) continue
        if (eb.y > H + 10 || eb.y < -10 || eb.x < -10 || eb.x > W + 10) { eb.dead = true; continue }
        if (Math.abs(eb.x - player.x) < phw && Math.abs(eb.y - player.y) < phh) {
          eb.dead = true
          loseLife()
          if (state !== 'playing') return
        }
      }

      // -------- collisions: diving enemies vs player --------
      for (const e of enemies) {
        if (!e.alive) continue
        if (Math.abs(e.x - player.x) < phw + 12 && Math.abs(e.y - player.y) < phh + 12) {
          e.alive = false
          burst(e.x, e.y, e.color, 16)
          loseLife()
          if (state !== 'playing') return
        }
      }

      // -------- collisions: boss body vs player --------
      if (boss && !boss.entering) {
        if (Math.abs(boss.x - player.x) < boss.w / 2 + phw && Math.abs(boss.y - player.y) < boss.h / 2 + phh) {
          loseLife()
          if (state !== 'playing') return
        }
      }

      // -------- power-up pickup --------
      for (const pu of powerups) {
        if (pu.dead) continue
        if (pu.y > H + 20) { pu.dead = true; continue }
        if (Math.abs(pu.x - player.x) < phw + 12 && Math.abs(pu.y - player.y) < phh + 12) {
          pu.dead = true
          applyPowerup(pu.kind)
        }
      }

      // -------- cull off-screen + dead --------
      bullets = bullets.filter((b) => !b.dead && b.y > -20 && b.y < H + 20 && b.x > -20 && b.x < W + 20)
      ebullets = ebullets.filter((eb) => !eb.dead)
      enemies = enemies.filter((e) => e.alive)
      powerups = powerups.filter((pu) => !pu.dead)

      // enforce caps defensively
      if (bullets.length > MAX_BULLETS) bullets.length = MAX_BULLETS
      if (ebullets.length > MAX_EBULLETS) ebullets.length = MAX_EBULLETS
      if (particles.length > MAX_PARTICLES) particles.length = MAX_PARTICLES

      // -------- wave cleared (non-boss) --------
      if (!boss && enemies.length === 0) {
        spawnTimer -= dt
        if (spawnTimer <= 0) nextWave()
      }
    }

    // ---------- input ----------
    function onKeyDown(e) {
      const k = e.code
      if (k === 'ArrowLeft' || k === 'KeyA') { keys.left = true; e.preventDefault() }
      else if (k === 'ArrowRight' || k === 'KeyD') { keys.right = true; e.preventDefault() }
      else if (k === 'ArrowUp' || k === 'KeyW') { keys.up = true; e.preventDefault() }
      else if (k === 'ArrowDown' || k === 'KeyS') { keys.down = true; e.preventDefault() }
      else if (k === 'Space') {
        e.preventDefault()
        if (state === 'ready') state = 'playing'
        else if (state === 'over') newGame()
        else keys.fire = true
      }
    }
    function onKeyUp(e) {
      const k = e.code
      if (k === 'ArrowLeft' || k === 'KeyA') keys.left = false
      else if (k === 'ArrowRight' || k === 'KeyD') keys.right = false
      else if (k === 'ArrowUp' || k === 'KeyW') keys.up = false
      else if (k === 'ArrowDown' || k === 'KeyS') keys.down = false
      else if (k === 'Space') keys.fire = false
    }
    function onPointerMove(e) {
      if (auto) return
      const rect = canvas.getBoundingClientRect()
      const x = (e.clientX - rect.left) * (W / rect.width)
      const y = (e.clientY - rect.top) * (H / rect.height)
      player.x = Math.max(16, Math.min(W - 16, x))
      player.y = Math.max(PLAYER_MIN_Y, Math.min(PLAYER_MAX_Y, y))
    }
    function onPointerDown() {
      if (state === 'ready') state = 'playing'
      else if (state === 'over') newGame()
      else keys.fire = true
    }
    function onPointerUp() { keys.fire = false }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointerup', onPointerUp)

    // ---------- drawing ----------
    function sparkle(x, y, s) {
      ctx.strokeStyle = PINK; ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(x - s, y); ctx.lineTo(x + s, y)
      ctx.moveTo(x, y - s); ctx.lineTo(x, y + s)
      ctx.stroke()
    }

    function drawShip(x, y) {
      ctx.save()
      ctx.translate(x, y)
      ctx.fillStyle = PINK
      ctx.shadowColor = PINK; ctx.shadowBlur = 16
      ctx.beginPath()
      ctx.moveTo(0, -PLAYER_H / 2)
      ctx.lineTo(PLAYER_W / 2, PLAYER_H / 2)
      ctx.lineTo(PLAYER_W / 4, PLAYER_H / 2 - 5)
      ctx.lineTo(0, PLAYER_H / 2 - 2)
      ctx.lineTo(-PLAYER_W / 4, PLAYER_H / 2 - 5)
      ctx.lineTo(-PLAYER_W / 2, PLAYER_H / 2)
      ctx.closePath()
      ctx.fill()
      // cockpit
      ctx.shadowBlur = 0
      ctx.fillStyle = '#fff'
      ctx.beginPath()
      ctx.arc(0, -2, 3.5, 0, Math.PI * 2)
      ctx.fill()
      // thruster flame
      ctx.fillStyle = '#ffd60a'
      ctx.shadowColor = '#ffd60a'; ctx.shadowBlur = 10
      const f = 4 + Math.random() * 6
      ctx.beginPath()
      ctx.moveTo(-5, PLAYER_H / 2 - 2)
      ctx.lineTo(0, PLAYER_H / 2 + f)
      ctx.lineTo(5, PLAYER_H / 2 - 2)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
      ctx.shadowBlur = 0
    }

    function drawEnemy(e) {
      ctx.save()
      ctx.translate(e.x, e.y)
      ctx.fillStyle = e.color
      ctx.shadowColor = e.color; ctx.shadowBlur = 12
      // little neon bug: body + wings
      ctx.beginPath()
      ctx.moveTo(0, 12)
      ctx.lineTo(-12, 0)
      ctx.lineTo(-8, -8)
      ctx.lineTo(0, -4)
      ctx.lineTo(8, -8)
      ctx.lineTo(12, 0)
      ctx.closePath()
      ctx.fill()
      ctx.shadowBlur = 0
      ctx.fillStyle = '#0a0a0a'
      ctx.fillRect(-4, -2, 3, 3)
      ctx.fillRect(1, -2, 3, 3)
      ctx.restore()
      ctx.shadowBlur = 0
    }

    function drawBoss(b) {
      ctx.save()
      ctx.translate(b.x, b.y)
      ctx.fillStyle = b.color
      ctx.shadowColor = b.color; ctx.shadowBlur = 22
      ctx.beginPath()
      ctx.moveTo(0, b.h / 2)
      ctx.lineTo(-b.w / 2, 0)
      ctx.lineTo(-b.w / 3, -b.h / 2)
      ctx.lineTo(b.w / 3, -b.h / 2)
      ctx.lineTo(b.w / 2, 0)
      ctx.closePath()
      ctx.fill()
      ctx.shadowBlur = 0
      ctx.fillStyle = '#ffd60a'
      ctx.beginPath(); ctx.arc(-b.w / 4, 0, 6, 0, Math.PI * 2); ctx.fill()
      ctx.beginPath(); ctx.arc(b.w / 4, 0, 6, 0, Math.PI * 2); ctx.fill()
      ctx.restore()
      ctx.shadowBlur = 0
    }

    function label(x, y, text, value, align) {
      ctx.textAlign = align || 'left'
      ctx.fillStyle = PINK; ctx.font = '700 11px system-ui, sans-serif'
      ctx.fillText(text, x, y)
      ctx.fillRect(align === 'right' ? x - 22 : x, y + 4, 22, 3)
      ctx.fillStyle = '#fff'; ctx.font = '800 19px system-ui, sans-serif'
      ctx.fillText(String(value), x, y + 27)
    }

    function draw() {
      ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, W, H)

      // starfield
      for (const s of stars) {
        ctx.globalAlpha = 0.3 + (s.s / 2.2) * 0.7
        ctx.fillStyle = s.s > 1.6 ? '#2de2e6' : '#cfd6e6'
        ctx.fillRect(s.x, s.y, s.s, s.s)
      }
      ctx.globalAlpha = 1

      sparkle(24, 70, 5); sparkle(W - 24, H - 24, 4)

      // power-ups
      for (const pu of powerups) {
        const col = pu.kind === 'shield' ? '#2de2e6' : pu.kind === 'rapid' ? '#ffd60a' : '#b14aed'
        ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 12
        ctx.beginPath(); ctx.arc(pu.x, pu.y, 9, 0, Math.PI * 2); ctx.fill()
        ctx.shadowBlur = 0
        ctx.fillStyle = '#0a0a0a'; ctx.font = '800 10px system-ui, sans-serif'; ctx.textAlign = 'center'
        ctx.fillText(pu.kind === 'shield' ? 'S' : pu.kind === 'rapid' ? 'R' : 'W', pu.x, pu.y + 3.5)
      }

      // enemies / boss
      for (const e of enemies) if (e.alive) drawEnemy(e)
      if (boss) drawBoss(boss)

      // player bullets
      ctx.fillStyle = '#fff'; ctx.shadowColor = '#fff'; ctx.shadowBlur = 12
      for (const b of bullets) ctx.fillRect(b.x - 1.5, b.y - 8, 3, 12)
      ctx.shadowBlur = 0

      // enemy bullets
      ctx.fillStyle = '#ff8a1e'; ctx.shadowColor = '#ff8a1e'; ctx.shadowBlur = 10
      for (const eb of ebullets) { ctx.beginPath(); ctx.arc(eb.x, eb.y, 3, 0, Math.PI * 2); ctx.fill() }
      ctx.shadowBlur = 0

      // particles
      for (const p of particles) {
        ctx.globalAlpha = Math.max(0, p.life / p.max)
        ctx.fillStyle = p.color
        ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3)
      }
      ctx.globalAlpha = 1

      // player ship (blink while shielded/respawn)
      if (state === 'playing' || state === 'ready') {
        const shielded = shieldTimer > 0
        if (!shielded || Math.floor(formationPhase * 12) % 2 === 0 || shieldTimer > 1.6) {
          drawShip(player.x, player.y)
        }
        if (shielded) {
          ctx.strokeStyle = '#2de2e6'; ctx.shadowColor = '#2de2e6'; ctx.shadowBlur = 12
          ctx.lineWidth = 2
          ctx.beginPath(); ctx.arc(player.x, player.y, 22, 0, Math.PI * 2); ctx.stroke()
          ctx.shadowBlur = 0
        }
      }

      // HUD
      label(16, 28, 'SCORE', score)
      label(W / 2 - 30, 28, 'WAVE', wave)
      label(W - 16, 28, 'BEST', best, 'right')
      // lives row
      ctx.textAlign = 'left'
      ctx.fillStyle = PINK; ctx.font = '700 11px system-ui, sans-serif'
      ctx.fillText('LIVES', W / 2 + 40, 28)
      ctx.fillRect(W / 2 + 40, 32, 22, 3)
      for (let i = 0; i < lives; i++) {
        const lx = W / 2 + 46 + i * 16
        ctx.fillStyle = PINK; ctx.shadowColor = PINK; ctx.shadowBlur = 8
        ctx.beginPath()
        ctx.moveTo(lx, 42); ctx.lineTo(lx + 5, 52); ctx.lineTo(lx - 5, 52)
        ctx.closePath(); ctx.fill()
      }
      ctx.shadowBlur = 0

      // boss health bar
      if (boss) {
        const bw = W - 80
        ctx.fillStyle = '#2a1a22'; ctx.fillRect(40, 64, bw, 8)
        ctx.fillStyle = PINK; ctx.shadowColor = PINK; ctx.shadowBlur = 10
        ctx.fillRect(40, 64, bw * Math.max(0, boss.hp / boss.maxHp), 8)
        ctx.shadowBlur = 0
        ctx.fillStyle = PINK; ctx.font = '700 10px system-ui, sans-serif'; ctx.textAlign = 'center'
        ctx.fillText('BOSS', W / 2, 60)
      }

      // active power-up indicator
      if (powerKind && powerTimer > 0) {
        ctx.fillStyle = MUTED; ctx.font = '700 11px system-ui, sans-serif'; ctx.textAlign = 'left'
        ctx.fillText((powerKind === 'spread' ? 'SPREAD' : 'RAPID') + '  ' + powerTimer.toFixed(1) + 's', 16, H - 32)
      }

      // footer hint
      ctx.fillStyle = MUTED; ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'center'
      ctx.fillText('← →  /  A D  move   ·   space  fire   ·   reach wave ' + WIN_WAVE, W / 2, H - 14)

      if (state === 'ready') overlay('SPACE SHOOTER', 'space / tap to start')
      else if (state === 'over') overlay('GAME OVER', 'space / tap to play again')
    }

    function overlay(title, sub) {
      ctx.fillStyle = 'rgba(10,10,10,0.78)'; ctx.fillRect(0, H / 2 - 70, W, 140)
      ctx.textAlign = 'center'
      ctx.fillStyle = PINK; ctx.font = '800 34px system-ui, sans-serif'
      ctx.fillText(title, W / 2, H / 2)
      ctx.fillStyle = PINK; ctx.fillRect(W / 2 - 70, H / 2 + 12, 140, 4)
      ctx.fillStyle = '#fff'; ctx.font = '600 14px system-ui, sans-serif'
      ctx.fillText(sub, W / 2, H / 2 + 42)
    }

    function loop(now) {
      let dt = (now - last) / 1000; last = now
      if (dt > 0.05) dt = 0.05
      update(dt)
      draw()
      raf = requestAnimationFrame(loop)
    }

    newGame()
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointerup', onPointerUp)
    }
  }, [])

  return (
    <canvas ref={canvasRef} width={W} height={H} className="shooter-canvas" aria-label="Space shooter game" />
  )
}
