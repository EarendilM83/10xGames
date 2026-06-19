# PRD — 10x Games: Flappy Bird (React + Canvas)

**Owner:** Nukri Tusishvili · **Audience for demo:** prospective students · **Status:** v1 shipped, tuning for demo
**Context:** First game in an extensible "10x Games" platform. Built to be *seen* — a live, playable hook for a 10x presentation.

---

## 1. Why this, why now

A working game you can hand to a student and say *"beat my score"* is the most persuasive slide in any deck. Flappy Bird is the ideal first game: **one rule, instant understanding, instant replay, and a famous story** (built in a weekend, made ~$50k/day, deleted by its creator — see `01-RESEARCH.md`). It proves the platform works and makes the audience *play*, not just watch.

## 2. Goals & success criteria

| Goal | Measure of success |
|---|---|
| **Platform is extensible** | Adding a new game = **1 entry** in `src/games/index.js`, zero other changes |
| **Game is demo-ready** | Runs at 60fps, no crashes, restart in <1s, works on laptop + touchscreen |
| **Instantly understandable** | A new player understands the goal in **<5 seconds**, no instructions read |
| **Sticky in a demo** | Players retry without prompting; high score persists across attempts |
| **Visually polished** | Looks intentional and branded, not "a coding exercise" |

**Non-goals (v1):** accounts, online leaderboards, sound, mobile app packaging, monetization, pixel-perfect sprite replication of the original.

## 3. Users

- **Primary:** prospective students at the 10x presentation — play it on the spot.
- **Secondary:** the presenter (Nukri) — needs it to *never embarrass* on stage (no crashes, easy restart).
- **Tertiary:** future devs — will add game #2, #3 to the platform.

## 4. Scope — what we built (v1)

### 4.1 Platform shell
- **Game selector** home screen: branded "10x Games" hero + a responsive grid of game cards.
- **Registry-driven**: every card, its accent color, and routing come from one array (`src/games/index.js`).
- **Game view**: top bar with "← All games" back button, game title, 10x mark; canvas centered on stage.
- A **"More soon"** placeholder card signals the platform will grow (good narrative for the deck).

### 4.2 Flappy Bird game (Canvas)
- Single `<canvas>` at 400×600 internal resolution, CSS-scaled responsively.
- **States:** `Ready → Playing → Game Over → (restart) → Ready`.
- **Controls:** click / tap / **Space** / **↑** — all flap. One verb, like the original.
- **Physics:** gravity + flap impulse, **delta-time normalized to 60fps** (consistent on any monitor; survives tab-switches via a dt clamp).
- **World:** procedurally spawned pipe pairs with a fixed gap; scrolling ground; drifting parallax clouds; gradient sky.
- **Scoring:** +1 per pipe pair cleared; **high score persisted to `localStorage`**.
- **Collision:** bird vs. pipe / ground / ceiling → game over.
- **Feel polish:** bird tilts with velocity, wing flaps, gentle bob on the ready screen.

### 4.3 Tunable constants (top of `src/games/FlappyBird.jsx`)
Because the **original physics were never published** (verified — see research), feel is tuned by hand:
`GRAVITY`, `FLAP`, `PIPE_SPEED`, `PIPE_GAP`, `PIPE_INTERVAL`, `BIRD_R`.

## 5. Requirements

### Functional
1. From the home grid, selecting a game opens it; "← All games" returns. ✅
2. Flappy Bird starts in a **Ready** state showing how to play. ✅
3. Any flap input from Ready starts play; from Game Over, restarts. ✅
4. Bird falls under gravity and rises on flap. ✅
5. Pipes scroll; clearing a pair scores +1. ✅
6. Any collision ends the run and shows **score + best**. ✅
7. High score survives a page reload. ✅

### Non-functional
- **Performance:** steady 60fps on a mid laptop; no GC stutter during play.
- **Robustness:** game loop fully cleaned up on unmount (cancel rAF, remove listeners) — switching games never leaks. ✅
- **Responsive:** canvas fits within `min(80vh, 600px)`; usable from 320px width up.
- **Input latency:** flap responds on the same frame as the tap.
- **Build:** `npm run build` succeeds; ~48KB gzipped JS.

## 6. Difficulty tuning (the one thing to verify live)

The single biggest demo risk is **difficulty feel**. Too hard → students bounce after 2 tries; too easy → not impressive. Tune for **"reachable score of 5–10 on the first minute"**:

| Lever | Easier ⟵ | Current | ⟶ Harder |
|---|---|---|---|
| `PIPE_GAP` | bigger (180) | 165 | smaller (130) |
| `PIPE_SPEED` | slower (1.8) | 2.4 | faster (3.0) |
| `GRAVITY` | lower (0.35) | 0.45 | higher (0.6) |
| `PIPE_INTERVAL` | longer (1800ms) | 1500ms | shorter (1100ms) |

**Action before the demo:** play 5 rounds, adjust to taste. This is a 30-second edit.

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Crash on stage | Loop has dt clamp + full cleanup; tested build passes |
| Too hard, audience gives up | Pre-tune gap/speed (§6); start gentle |
| Looks unfinished | Branded shell, gradient art, animated bird already in v1 |
| Claiming unverifiable "facts" | Research brief flags refuted myths — stick to "reportedly $50k/day," "50M+ downloads" |

## 8. Future (the "10x platform" story for the deck)

- **Game #2 & #3** (Snake, Breakout) — proves the registry pattern in seconds, live.
- Sound effects (flap / score / death).
- Difficulty modes; per-game leaderboards.
- Shareable score cards.

---
*v1 is built and verified: build passes, dev server serves, all modules transform. Remaining work is difficulty tuning (§6) and optionally a second game for the platform narrative.*
