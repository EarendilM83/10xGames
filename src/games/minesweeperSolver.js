// Minesweeper logic solver — used to guarantee "no-guess" boards.
//
// Authentic deduction (per research: Kaye, Studholme, Kunz, JSMinesweeper):
//   1. Single-point: number==knownMines → rest safe; number-knownMines==hidden → rest mines.
//   2. CSP backbone: enumerate satisfying assignments per connected frontier component;
//      a cell with the same value in ALL assignments is provably safe (0) or mine (1).
//   3. Global mine-count shortcuts (remaining==0 → all safe; hidden==remaining → all mines).
//
// solve() simulates a perfect logical player on a KNOWN mine layout and returns true
// iff the board can be fully cleared with NO guessing. Sound (never a false accept);
// CSP omits the global-count combination, so it may reject some boards solvable only
// by global counting — that just means a few extra generation attempts.

const MAX_COMPONENT = 22 // cap enumeration size (2^n); larger components are left undecided

export function solve(mine, ROWS, COLS, MINES, startR, startC) {
  // state: 0 hidden, 1 open, 2 known-mine
  const st = Array.from({ length: ROWS }, () => new Int8Array(COLS))

  const adj = (r, c) => {
    let n = 0
    eachN(r, c, ROWS, COLS, (rr, cc) => { if (mine[rr][cc]) n++ })
    return n
  }

  // open a safe cell, flood-filling zeros (mirrors the game's reveal)
  const open = (r, c) => {
    const stack = [[r, c]]
    while (stack.length) {
      const [cr, cc] = stack.pop()
      if (st[cr][cc] !== 0) continue
      st[cr][cc] = 1
      if (adj(cr, cc) === 0) eachN(cr, cc, ROWS, COLS, (rr, ccx) => {
        if (st[rr][ccx] === 0) stack.push([rr, ccx])
      })
    }
  }

  open(startR, startC)

  for (;;) {
    let progress = false

    // count hidden / known mines
    let hidden = 0, knownMines = 0
    const hiddenCells = []
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (st[r][c] === 0) { hidden++; hiddenCells.push([r, c]) }
      else if (st[r][c] === 2) knownMines++
    }
    const remaining = MINES - knownMines

    // ---- global shortcuts ----
    if (remaining === 0 && hidden > 0) {
      for (const [r, c] of hiddenCells) open(r, c)
      continue
    }
    if (remaining === hidden && hidden > 0) {
      for (const [r, c] of hiddenCells) st[r][c] = 2
      continue
    }

    // ---- single-point ----
    for (let r = 0; r < ROWS && !progress; r++) for (let c = 0; c < COLS; c++) {
      if (st[r][c] !== 1) continue
      const k = adj(r, c)
      let mines = 0
      const hid = []
      eachN(r, c, ROWS, COLS, (rr, cc) => {
        if (st[rr][cc] === 2) mines++
        else if (st[rr][cc] === 0) hid.push([rr, cc])
      })
      if (hid.length === 0) continue
      if (k - mines === 0) { for (const [rr, cc] of hid) open(rr, cc); progress = true; break }
      if (k - mines === hid.length) { for (const [rr, cc] of hid) st[rr][cc] = 2; progress = true; break }
    }
    if (progress) continue

    // ---- CSP backbone over connected frontier components ----
    if (cspStep(st, ROWS, COLS, adj, open)) continue

    // ---- no progress: solved iff every non-mine cell is open ----
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (!mine[r][c] && st[r][c] !== 1) return false
    }
    return true
  }
}

// Deduce the next provably-safe / provably-mine cells from the CURRENT visible board,
// using the same logic the generator accepts boards with (single-point + CSP backbone
// + global mine count). Reused by the autoplay bot so it has the same deduction power.
//
// `visible[r][c]` = { revealed, flagged, adj } where `adj` is the displayed clue number
// for revealed non-mine cells (only read when revealed). MINES is the total mine count.
// Returns { safe: [[r,c]...], mines: [[r,c]...] } — cells the bot can reveal/flag with proof.
export function deduce(visible, ROWS, COLS, MINES) {
  // st: 0 hidden, 1 open, 2 known-mine (flagged by the player counts as known-mine)
  const st = Array.from({ length: ROWS }, () => new Int8Array(COLS))
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (visible[r][c].revealed) st[r][c] = 1
    else if (visible[r][c].flagged) st[r][c] = 2
  }
  // clue value for an open cell comes from the visible adjacency number
  const adj = (r, c) => visible[r][c].adj

  const safe = []
  const mines = []
  const markSafe = (r, c) => { if (st[r][c] === 0) { st[r][c] = 1; safe.push([r, c]) } }
  const markMine = (r, c) => { if (st[r][c] === 0) { st[r][c] = 2; mines.push([r, c]) } }
  // `open` for cspStep: a forced-safe frontier cell becomes "open" in st AND is recorded.
  // (We don't have its clue, so it can't yield further single-point this call — but on the
  // next bot tick the cell is really revealed and its clue feeds the next deduce().)
  const open = (r, c) => markSafe(r, c)

  // Iterate single-point + global-count to a fixpoint, then CSP, then loop — mirroring solve()
  // so the bot has the exact deduction power the generator accepted the board with. Each
  // newly proven cell is accumulated; we return everything proven from this visible state.
  for (;;) {
    let progress = false

    // global mine-count shortcuts
    let hidden = 0, knownMines = 0
    const hiddenCells = []
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (st[r][c] === 0) { hidden++; hiddenCells.push([r, c]) }
      else if (st[r][c] === 2) knownMines++
    }
    const remaining = MINES - knownMines
    if (remaining === 0 && hidden > 0) { for (const [r, c] of hiddenCells) markSafe(r, c); break }
    if (remaining === hidden && hidden > 0) { for (const [r, c] of hiddenCells) markMine(r, c); break }

    // single-point
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (st[r][c] !== 1) continue
      const k = adj(r, c)
      let m = 0
      const hid = []
      eachN(r, c, ROWS, COLS, (rr, cc) => {
        if (st[rr][cc] === 2) m++
        else if (st[rr][cc] === 0) hid.push([rr, cc])
      })
      if (hid.length === 0) continue
      if (k - m === 0) for (const [rr, cc] of hid) { if (st[rr][cc] === 0) progress = true; markSafe(rr, cc) }
      else if (k - m === hid.length) for (const [rr, cc] of hid) { if (st[rr][cc] === 0) progress = true; markMine(rr, cc) }
    }
    if (progress) continue

    // CSP backbone — reuse the same routine the solver uses. It "opens" forced-safe cells via
    // the `open` callback and marks forced-mine cells directly with st[r][c]=2. Snapshot st to
    // capture the mines it newly proved.
    const before = st.map((row) => Int8Array.from(row))
    if (cspStep(st, ROWS, COLS, adj, open)) {
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        if (st[r][c] === 2 && before[r][c] !== 2) mines.push([r, c])
      }
      continue
    }
    break // no further deduction possible
  }
  return { safe, mines }
}

function eachN(r, c, ROWS, COLS, fn) {
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (dr === 0 && dc === 0) continue
    const rr = r + dr, cc = c + dc
    if (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS) fn(rr, cc)
  }
}

// Build constraints from the open frontier, split into connected components,
// enumerate each, and apply any cell forced to one value across all solutions.
function cspStep(st, ROWS, COLS, adj, open) {
  // constraints: { cells: ["r,c"...], sum }
  const constraints = []
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (st[r][c] !== 1) continue
    let mines = 0
    const hid = []
    eachN(r, c, ROWS, COLS, (rr, cc) => {
      if (st[rr][cc] === 2) mines++
      else if (st[rr][cc] === 0) hid.push(rr + ',' + cc)
    })
    if (hid.length > 0) constraints.push({ cells: hid, sum: adj(r, c) - mines })
  }
  if (!constraints.length) return false

  // union-find over frontier cells (cells sharing a constraint are connected)
  const parent = new Map()
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x) } return x }
  const union = (a, b) => { parent.set(find(a), find(b)) }
  for (const con of constraints) for (const cell of con.cells) if (!parent.has(cell)) parent.set(cell, cell)
  for (const con of constraints) for (let i = 1; i < con.cells.length; i++) union(con.cells[0], con.cells[i])

  // group cells + constraints by component root
  const compCells = new Map()
  for (const cell of parent.keys()) {
    const root = find(cell)
    if (!compCells.has(root)) compCells.set(root, [])
    compCells.get(root).push(cell)
  }
  const compCons = new Map()
  for (const con of constraints) {
    const root = find(con.cells[0])
    if (!compCons.has(root)) compCons.set(root, [])
    compCons.get(root).push(con)
  }

  let progress = false
  for (const [root, cells] of compCells) {
    if (cells.length > MAX_COMPONENT) continue
    const forced = enumerate(cells, compCons.get(root) || [])
    if (!forced) continue
    for (const [cell, val] of forced) {
      const [r, c] = cell.split(',').map(Number)
      if (st[r][c] !== 0) continue
      if (val === 0) { open(r, c); progress = true }
      else { st[r][c] = 2; progress = true }
    }
  }
  return progress
}

// Enumerate all 0/1 assignments of `cells` satisfying `constraints`;
// return Map of cells that hold the same value in every solution (the backbone).
function enumerate(cells, constraints) {
  const idx = new Map()
  cells.forEach((cell, i) => idx.set(cell, i))
  const n = cells.length
  const cons = constraints.map((con) => ({ idxs: con.cells.map((c) => idx.get(c)), sum: con.sum }))
  const consOf = Array.from({ length: n }, () => [])
  cons.forEach((con, ci) => con.idxs.forEach((i) => consOf[i].push(ci)))

  const assign = new Int8Array(n).fill(-1)
  const seen0 = new Uint8Array(n)
  const seen1 = new Uint8Array(n)
  let solutions = 0

  const feasible = (i) => {
    for (const ci of consOf[i]) {
      const con = cons[ci]
      let s = 0, un = 0
      for (const j of con.idxs) { if (assign[j] === -1) un++; else s += assign[j] }
      if (s > con.sum) return false
      if (s + un < con.sum) return false
    }
    return true
  }

  const dfs = (i) => {
    if (i === n) {
      solutions++
      for (let k = 0; k < n; k++) { if (assign[k] === 0) seen0[k] = 1; else seen1[k] = 1 }
      return
    }
    for (let v = 0; v <= 1; v++) {
      assign[i] = v
      if (feasible(i)) dfs(i + 1)
    }
    assign[i] = -1
  }
  dfs(0)

  if (solutions === 0) return null
  const forced = new Map()
  for (let k = 0; k < n; k++) {
    if (seen0[k] && !seen1[k]) forced.set(cells[k], 0)
    else if (seen1[k] && !seen0[k]) forced.set(cells[k], 1)
  }
  return forced
}
