# 10x Presentation — Visual Deck Plan

**Audience:** prospective students. **Goal:** make them *feel* "I could build this — here." **Principle:** every slide is one image + one idea. Talk over visuals; never read bullets.

> 🎨 **Visual system** — keep it consistent on every slide:
> - **Palette:** night-blue background `#0b0f1a` → `#1b2440`, bird-yellow `#ffd60a`, pipe-green `#7ed01a`, sky-blue `#4ec0ff`. (Same as the live app — the deck and the game match.)
> - **Type:** one bold sans (system-ui / Inter). Huge numbers, few words.
> - **Motion:** the bird flies in / pipes slide. Use the real game palette so the slides feel like the game.

---

## The arc (9 beats, ~6–8 min + live play)

```
1 HOOK ▸ 2 WHAT ▸ 3 THE STORY ▸ 4 THE NUMBERS ▸ 5 WHY HARD
        ▸ 6 LIVE DEMO ▸ 7 HOW IT'S BUILT ▸ 8 THE PLATFORM ▸ 9 YOUR TURN
```

---

### Slide 1 — HOOK 🐤
- **Visual:** full-bleed game art. Just the bird mid-flap between two pipes, frozen. Big.
- **Words (one line):** *"A man built this in a weekend. It made $50,000 a day. Then he deleted it."*
- **Why:** curiosity gap. Nobody looks away.

### Slide 2 — WHAT IT IS
- **Visual:** the bird sprite + a single finger-tap icon → arrow up. Three tiny frames: tap → rise → fall.
- **Words:** **"One tap. That's the whole game."**
- **Note:** define the rule in 5 seconds — tap to flap through pipe gaps, one hit = over. *(Source: §1 research.)*

### Slide 3 — THE STORY 📖
- **Visual:** a clean timeline ribbon (use the green pipe as the timeline bar):
  ```
  May 2013 ───────── early 2014 ───────── Feb 10 2014
  released          #1 in 53 countries    deleted at the peak
  ```
- **Words:** *"Solo Vietnamese dev, Dong Nguyen. Built in 2–3 days."*
- ⚠️ Don't date the removal to a "Feb 9 tweet" or say "Jan 17 #1" — those were refuted. Use the safe dates above.

### Slide 4 — THE NUMBERS 💰
- **Visual:** three giant stat cards, animate the numbers counting up:
  | `2–3` | `53` | `~$50K` |
  |---|---|---|
  | days to build | countries at #1 | per day (reported) |
- **Footer in small type:** "50M+ downloads · revenue self-reported." (Honesty = credibility with students.)

### Slide 5 — WHY IT'S SO HARD 🧠
- **Visual:** a tight pipe gap with the bird squeezing through; a looping "fail → instant retry" circle diagram.
- **Words:** **"Easy to learn. Impossible to master."**
- **Note:** instant death + instant restart = the "just one more try" loop. *(Source: §4 — Scientific American / Rolling Stone.)*

### Slide 6 — LIVE DEMO 🎮 *(the centerpiece — spend the most time here)*
- **Visual:** **leave the slides. Open the actual app.** Full screen.
- **Do:** play one round live, die, restart instantly. Then **hand it to a student / put the score on screen and say "beat it."**
- **Why:** this is the whole presentation. They watch a real thing run, then *play it themselves*. Nothing on a slide beats that.
- **Backup:** have it already running in a browser tab so there's zero loading risk.

### Slide 7 — HOW IT'S BUILT ⚙️
- **Visual:** the game loop as a 4-icon cycle (gravity ↓ · tap ↑ · move pipes ← · check hit 💥), and the word **Canvas** + **React** logos.
- **Words:** **"React for the menu. Canvas for the pixels. ~150 lines for the game."**
- **Note:** honest engineering: the original's exact physics were never published — *we tuned the feel ourselves.* (Great teaching moment: real game dev is iteration, not magic numbers.)

### Slide 8 — THE PLATFORM 🕹️
- **Visual:** screenshot of the **game selector grid** — Flappy Bird card + a glowing **"More soon"** card.
- **Words:** **"Adding the next game = one line of code."** Show the `src/games/index.js` registry entry on screen.
- **Why:** sells the *system*, not one game. Students see a path: "I could add mine here."

### Slide 9 — YOUR TURN ✨
- **Visual:** the bird flying up and off the top of the slide, leaving a score trail.
- **Words:** **"You can build this. Come learn how at 10x."**
- **CTA:** QR code / link to the running game so they keep playing after they leave.

---

## Production checklist (before tomorrow)

- [ ] **Tune difficulty** — play 5 rounds, adjust `PIPE_GAP` / `PIPE_SPEED` (see PRD §6). Aim: first-minute score of 5–10.
- [ ] **Pre-open the app** in a browser tab (zero load risk on stage). `npm run dev` → `localhost:5173`.
- [ ] **Take 2 screenshots** for slides 1 & 8 (game art + selector grid).
- [ ] **Practice the demo death+restart** so it looks smooth, not fumbly.
- [ ] **Memorize the 3 numbers** (2–3 days · 53 countries · ~$50k/day) — say them, don't read them.
- [ ] **One backup laptop / charged battery.** The live demo is the slide.

## Delivery tips for a student audience
- **Play, don't pitch.** The moment a student touches the keyboard, you've won.
- **Be honest about the unknowns** (physics tuned by feel, revenue self-reported) — it builds trust and models real engineering.
- **End on "you can do this here."** The bird flying off-screen = their potential leaving the room with them.

---
*Want this as an actual slide deck (HTML/Reveal.js or a Figma frame set) instead of a plan? Say the word and I'll generate it — the palette and assets are already defined above and in the live app.*
