import FlappyBird from './FlappyBird.jsx'
import Minesweeper from './Minesweeper.jsx'
import Tetris from './Tetris.jsx'
import Snake from './Snake.jsx'
import Game2048 from './Game2048.jsx'
import Pong from './Pong.jsx'
import TicTacToe from './TicTacToe.jsx'
import Breakout from './Breakout.jsx'
import MemoryMatch from './MemoryMatch.jsx'
import ConnectFour from './ConnectFour.jsx'
import Simon from './Simon.jsx'
import SpaceInvaders from './SpaceInvaders.jsx'
import Asteroids from './Asteroids.jsx'
import Tron from './Tron.jsx'
import DoodleJump from './DoodleJump.jsx'
import Frogger from './Frogger.jsx'
import MissileCommand from './MissileCommand.jsx'
import PacMan from './PacMan.jsx'
import BubbleShooter from './BubbleShooter.jsx'
import Othello from './Othello.jsx'
import Checkers from './Checkers.jsx'
import Match3 from './Match3.jsx'
import Wordle from './Wordle.jsx'
import TowerDefense from './TowerDefense.jsx'
import Platformer from './Platformer.jsx'
import Sokoban from './Sokoban.jsx'
import Chess from './Chess.jsx'
import Sudoku from './Sudoku.jsx'
import Blackjack from './Blackjack.jsx'
import Gomoku from './Gomoku.jsx'
import Battleship from './Battleship.jsx'
import Racing from './Racing.jsx'
import Suika from './Suika.jsx'
import Tanks from './Tanks.jsx'
import SuperLeap from './SuperLeap.jsx'
import Slots from './Slots.jsx'
import Survivors from './Survivors.jsx'
import Solitaire from './Solitaire.jsx'
import Nonogram from './Nonogram.jsx'
import FreeCell from './FreeCell.jsx'
import Mahjong from './Mahjong.jsx'
import Shooter from './Shooter.jsx'

// Display order of category sections on the home screen.
export const categories = ['Arcade', 'Puzzle', 'Logic & AI', 'Strategy', 'Cards', 'Memory']

// Game registry — add a new game here (with a `category`) and it shows up,
// grouped under its section, with its own URL (#/<id>) automatically.
export const games = [
  // ---------- Arcade ----------
  { id: 'flappy-bird', title: 'Flappy Bird', category: 'Arcade', tagline: 'Tap to flap. Dodge the pipes. Beat your high score.', emoji: '🐤', accent: '#ffd60a', component: FlappyBird },
  { id: 'snake', title: 'Snake', category: 'Arcade', tagline: 'Eat, grow, survive. Don’t bite your tail.', emoji: '🐍', accent: '#2de2e6', component: Snake },
  { id: 'pong', title: 'Pong', category: 'Arcade', tagline: 'The original. Solo vs CPU or 2-player head-to-head.', emoji: '🏓', accent: '#2de2e6', component: Pong },
  { id: 'breakout', title: 'Breakout', category: 'Arcade', tagline: 'Smash every brick. Don’t drop the ball.', emoji: '🧱', accent: '#ff2d6f', component: Breakout },
  { id: 'space-invaders', title: 'Space Invaders', category: 'Arcade', tagline: 'Blast the alien armada before it lands.', emoji: '👾', accent: '#54e346', component: SpaceInvaders },
  { id: 'asteroids', title: 'Asteroids', category: 'Arcade', tagline: 'Drift, blast rocks, survive the waves.', emoji: '🚀', accent: '#2de2e6', component: Asteroids },
  { id: 'tron', title: 'Tron', category: 'Arcade', tagline: 'Two light cycles, one grid. Don’t cross the streams.', emoji: '🏍️', accent: '#ff2d6f', component: Tron },
  { id: 'doodle-jump', title: 'Doodle Jump', category: 'Arcade', tagline: 'Bounce ever higher. Don’t miss a platform.', emoji: '⬆️', accent: '#4d7cff', component: DoodleJump },
  { id: 'frogger', title: 'Frogger', category: 'Arcade', tagline: 'Hop across traffic and river. Fill every lily pad.', emoji: '🐸', accent: '#54e346', component: Frogger },
  { id: 'missile-command', title: 'Missile Command', category: 'Arcade', tagline: 'Intercept the incoming barrage. Save the cities.', emoji: '🚀', accent: '#ff8a1e', component: MissileCommand },
  { id: 'pac-man', title: 'Pac-Man', category: 'Arcade', tagline: 'Chomp pellets, dodge four ghosts with minds of their own.', emoji: '🟡', accent: '#ffd60a', component: PacMan },
  { id: 'platformer', title: 'Platformer', category: 'Arcade', tagline: 'Run, jump, stomp, grab coins, reach the flag.', emoji: '🍄', accent: '#54e346', component: Platformer },

  // ---------- Puzzle ----------
  { id: 'tetris', title: 'Tetris', category: 'Puzzle', tagline: 'Stack the blocks. Clear the lines. Don’t top out.', emoji: '🟪', accent: '#b14aed', component: Tetris },
  { id: '2048', title: '2048', category: 'Puzzle', tagline: 'Slide and merge tiles. Reach 2048.', emoji: '🔢', accent: '#ffd60a', component: Game2048 },
  { id: 'bubble-shooter', title: 'Bubble Shooter', category: 'Puzzle', tagline: 'Aim, match 3+, drop the rest. Clear the board.', emoji: '🫧', accent: '#b14aed', component: BubbleShooter },
  { id: 'match-3', title: 'Match-3', category: 'Puzzle', tagline: 'Swap gems, chain cascades, beat your best in 30 moves.', emoji: '💎', accent: '#b14aed', component: Match3 },
  { id: 'wordle', title: 'Wordle', category: 'Puzzle', tagline: 'Six guesses, five letters. Crack the word.', emoji: '🟩', accent: '#54e346', component: Wordle },
  { id: 'sokoban', title: 'Sokoban', category: 'Puzzle', tagline: 'Push every crate onto its goal.', emoji: '📦', accent: '#ff8a1e', component: Sokoban },

  // ---------- Logic & AI ----------
  { id: 'minesweeper', title: 'Minesweeper', category: 'Logic & AI', tagline: 'Pure logic, no luck. Every board is solvable.', emoji: '💣', accent: '#ff2d6f', component: Minesweeper },
  { id: 'tic-tac-toe', title: 'Tic-Tac-Toe', category: 'Logic & AI', tagline: 'Beat the unbeatable AI. (You can’t — best you get is a draw.)', emoji: '⭕', accent: '#ff2d6f', component: TicTacToe },
  { id: 'connect-four', title: 'Connect Four', category: 'Logic & AI', tagline: 'Drop discs, line up four. Outsmart the alpha-beta CPU.', emoji: '🔴', accent: '#ffd60a', component: ConnectFour },
  { id: 'othello', title: 'Othello', category: 'Logic & AI', tagline: 'Flank, flip, flood the board. Grab the corners before the CPU.', emoji: '⚫', accent: '#2de2e6', component: Othello },
  { id: 'checkers', title: 'Checkers', category: 'Logic & AI', tagline: 'Forced jumps, multi-captures, kings — beat the alpha-beta CPU.', emoji: '🔴', accent: '#ff2d6f', component: Checkers },
  { id: 'chess', title: 'Chess', category: 'Logic & AI', tagline: 'Full legal chess vs an alpha-beta AI. Checkmate the CPU.', emoji: '♟️', accent: '#f5f6fa', component: Chess },
  { id: 'gomoku', title: 'Gomoku', category: 'Logic & AI', tagline: 'Five in a row. Outwit the threat-search AI.', emoji: '⬛', accent: '#ff2d6f', component: Gomoku },

  // ---------- Puzzle (added) ----------
  { id: 'sudoku', title: 'Sudoku', category: 'Puzzle', tagline: 'Fill the grid. One solution. Pure logic.', emoji: '🧩', accent: '#4d7cff', component: Sudoku },
  { id: 'suika', title: 'Suika', category: 'Puzzle', tagline: 'Drop and merge fruit. Chase the watermelon.', emoji: '🍉', accent: '#54e346', component: Suika },

  // ---------- Arcade (added) ----------
  { id: 'racing', title: 'Racing', category: 'Arcade', tagline: 'Hit the apex. Beat the pack over 3 laps.', emoji: '🏎️', accent: '#ff8a1e', component: Racing },
  { id: 'tanks', title: 'Tanks', category: 'Arcade', tagline: 'Defend the base. Blast the tank battalion.', emoji: '🪖', accent: '#ff8a1e', component: Tanks },
  { id: 'superleap', title: 'Super Leap', category: 'Arcade', tagline: 'Run, jump, stomp, grab coins, raise the flag.', emoji: '🍄', accent: '#54e346', component: SuperLeap },
  { id: 'survivors', title: 'Survivors', category: 'Arcade', tagline: 'Auto-attack the horde. Level up. Outlast.', emoji: '🧛', accent: '#b14aed', component: Survivors },
  { id: 'shooter', title: 'Space Shooter', category: 'Arcade', tagline: 'Blast the waves. Dodge the swarm. Kill the boss.', emoji: '🚀', accent: '#2de2e6', component: Shooter },

  // ---------- Puzzle (added 2) ----------
  { id: 'nonogram', title: 'Nonogram', category: 'Puzzle', tagline: 'Read the clues. Reveal the hidden picture.', emoji: '🖼️', accent: '#2de2e6', component: Nonogram },
  { id: 'mahjong', title: 'Mahjong', category: 'Puzzle', tagline: 'Match the free tiles. Clear the board.', emoji: '🀄', accent: '#54e346', component: Mahjong },

  // ---------- Strategy ----------
  { id: 'tower-defense', title: 'Tower Defense', category: 'Strategy', tagline: 'Build towers, hold the line, survive every wave.', emoji: '🏰', accent: '#ffd60a', component: TowerDefense },
  { id: 'battleship', title: 'Battleship', category: 'Strategy', tagline: 'Hunt the fleet. Sink them before they sink you.', emoji: '🚢', accent: '#4d7cff', component: Battleship },

  // ---------- Cards ----------
  { id: 'blackjack', title: 'Blackjack', category: 'Cards', tagline: 'Hit, stand, double. Beat the dealer to 21.', emoji: '♠️', accent: '#54e346', component: Blackjack },
  { id: 'solitaire', title: 'Solitaire', category: 'Cards', tagline: 'Klondike classic. Build the foundations, clear the table.', emoji: '🂡', accent: '#54e346', component: Solitaire },
  { id: 'freecell', title: 'FreeCell', category: 'Cards', tagline: 'Every deal is winnable — if you plan it right.', emoji: '🃏', accent: '#4d7cff', component: FreeCell },
  { id: 'slots', title: 'Slots', category: 'Cards', tagline: 'Spin the reels. Line up the symbols. Hit the jackpot.', emoji: '🎰', accent: '#ffd60a', component: Slots },

  // ---------- Memory ----------
  { id: 'memory', title: 'Memory', category: 'Memory', tagline: 'Flip and match the pairs in as few moves as you can.', emoji: '🃏', accent: '#b14aed', component: MemoryMatch },
  { id: 'simon', title: 'Simon', category: 'Memory', tagline: 'Watch the pattern. Repeat it. Don’t break the chain.', emoji: '🎵', accent: '#2de2e6', component: Simon },
]

export const getGame = (id) => games.find((g) => g.id === id)
