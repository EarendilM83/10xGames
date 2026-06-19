# Flappy Bird — Research Brief

*Fact base for the 10x presentation. Every claim below survived 3-vote adversarial verification (≥2/3 confirm). Refuted myths are flagged so we don't repeat them on stage.*

---

## TL;DR (the one-slide version)

> **Flappy Bird** is a one-tap arcade game where you keep a bird airborne by tapping to flap it through gaps between green pipes. One mistake = game over. A solo Vietnamese developer built it in **2–3 days**, it became the **#1 free app in 53 countries**, reportedly earned **~$50,000/day from ads** — and then he **deleted it at the peak** because it was *too addictive*.

That arc — built in a weekend, conquered the world, voluntarily killed — is the story students remember.

---

## 1. What it is

| | |
|---|---|
| **Genre** | One-button "endless" arcade survival |
| **Goal** | Fly as far as possible without hitting anything |
| **Input** | A single tap (the *only* control) |
| **Scoring** | +1 point for each pair of pipes you clear |
| **Failure** | Touch a pipe, the ground, or the ceiling → instant game over |

The whole game is one verb: **tap**. That radical simplicity is the entire pitch.

## 2. Who made it & the timeline

- Built by **Dong Nguyen**, a solo Vietnamese developer, under his studio **dotGears**. He wrote it in roughly **2–3 days**; its working title was *"Flap Flap."* <sup>[Wikipedia]</sup>
- Released on the **iOS App Store on May 24, 2013**. It sat quiet for months, then went viral in early 2014, hitting **#1 free in 53 countries**. <sup>[Wikipedia]</sup>
- Nguyen **removed it from both the App Store and Google Play on February 10, 2014**, at the height of its popularity. <sup>[Wikipedia]</sup>
- His stated reason: it had become **too addictive** and was disrupting people's lives — *not* a legal or trademark problem. <sup>[Rolling Stone]</sup>

> ⚠️ **Don't say on stage:** that it had "90 million downloads," or pin the removal to a "Feb 9 tweet / Jan 17 hit #1." Those specific claims were **refuted** in verification. Safe figure: **50M+ downloads**.

## 3. Why it blew up (virality + money)

- The game was **free, with no paid version and no way to remove ads** — pure ad-supported. <sup>[The Verge]</sup>
- Nguyen **self-reported ~$50,000/day in ad revenue** at its peak. <sup>[The Verge, GameSpot, TIME]</sup>
  - ⚠️ Caveat for honesty: this is an **unaudited self-report** in an interview — present it as "reportedly," not as audited fact.
- Reported **50M+ downloads** before removal. <sup>[The Verge]</sup>
- Virality drivers: brutal difficulty bred **"just one more try"** + **shareable scores** → social media bragging, rage clips, and an explosion of YouTube/Twitter content that fed itself.

## 4. Why it's so hard (and so addictive)

- The design taps a classic **"easy to learn, impossible to master"** loop — the same psychology as paddleball: a simple motion you can *never* truly win, only survive a little longer. <sup>[Rolling Stone, Scientific American]</sup>
- Punishingly tight pipe gaps + instant death + instant restart = an extremely short failure→retry cycle. No menus, no waiting. You fail and you're *already playing again*.
- This "**flow + frustration**" mix is what made it both maddening and impossible to put down. <sup>[Scientific American, The Conversation]</sup>

## 5. Cultural impact

- After removal, the App Store flooded with **clones** ("Splashy Fish," etc.), and Apple/Google began **rejecting apps with "Flappy" in the title**. <sup>[NBC News, TechCrunch]</sup>
- Became a defining case study in **viral game design, the ethics of addictiveness, and app-store cloning**. <sup>[Policy Review, TechCrunch]</sup>
- An **official revival returned in 2024**, ~10 years after the original vanished.

## 6. Mechanics & physics — what we can and can't know

The game loop, verified from the most-referenced open-source clone (`sourabhv/FlapPyBird`):

```
every frame:
  velocity += gravity        # bird constantly falls
  on tap: velocity = flap    # tap = sudden upward kick
  bird.y  += velocity
  move pipes left
  if bird passes a pipe pair: score += 1
  if bird hits pipe / ground / ceiling: game over
```

- The reference clone uses a **pipe gap of ~120 px**. <sup>[FlapPyBird]</sup>
- 🚫 **Critical caveat (this is a verified finding):** the **original 2013 physics constants — exact gravity, flap impulse, terminal velocity, pipe speed/spacing — were never published.** A claim asserting specific values was **refuted**. The 120 px gap and any constants are **clone values**, not gospel.
- **Implication for our build:** we **tune the feel empirically**. Our React + Canvas version already exposes `GRAVITY`, `FLAP`, `PIPE_GAP`, `PIPE_SPEED` as top-of-file constants for exactly this reason.

---

## Open questions (honest gaps)

1. Original 2013 physics constants — unknowable; tune by feel.
2. Lifetime revenue/downloads — unverifiable since the game was pulled.
3. Exact differences between the original, the FlapPyBird clone, and the 2024 official revival.
4. Original sprite sizes, palette, and audio cues — and their licensing — if we want pixel-faithful replication.

## Sources (by quality)

**Primary / strong secondary**
- Wikipedia — *Flappy Bird* (history & timeline)
- The Verge — "$50k per day" Dong Nguyen interview (Feb 5, 2014)
- Rolling Stone — "The Flight of the Birdman" Dong Nguyen interview
- TIME, GameSpot, CBS News — revenue & addictiveness corroboration
- `github.com/sourabhv/FlapPyBird` — reference implementation (mechanics)
- Scientific American, The Conversation — psychology of difficulty/flow
- TechCrunch, NBC News, Policy Review — clones & cultural/legal aftermath

*Verification stats: 5 search angles · 21 sources fetched · 85 claims extracted · 25 verified · 22 confirmed · 3 killed.*
