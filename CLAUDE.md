# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Vanilla JavaScript Tetris. No build tools, no dependencies, no package.json. Three files: `index.html` (DOM/canvas), `style.css` (dark retro theme), `game.js` (all game logic, ~300 lines).

## Running

No build/install step. Either open `index.html` directly in a browser, or serve statically:

```bash
python3 -m http.server 8000
# or
npx serve .
```

There is no test suite, linter, or formatter configured.

## Architecture

All game state and logic lives in `game.js` as module-level variables and functions (no classes, no build-time modules).

- **Board model**: `board` is a `ROWS × COLS` matrix (20×10); each cell is `0` (empty) or a piece color index `1–7`.
- **Pieces**: `PIECES` defines the 7 tetrominoes as square matrices; `current` and `next` hold `{ type, shape, x, y }`. Rotation (`rotateCW`) transposes + reverses rows rather than using precomputed rotation states.
- **Collision** (`collide`): checks a shape against board bounds and locked cells.
- **Wall kicks** (`tryRotate`): after rotating, tries offsets `[0, -1, 1, -2, 2]` columns until one doesn't collide.
- **Game loop** (`loop`): driven by `requestAnimationFrame`; accumulates elapsed time in `dropAccum` and advances the piece one row once `dropInterval` is exceeded.
- **Locking/clearing**: `lockPiece` → `merge` (writes piece into `board`) → `clearLines` (scans bottom-up, splices full rows, unshifts empty ones, recomputes score/level/`dropInterval`) → `spawn` (promotes `next` to `current`, generates new `next`; if the new piece immediately collides, calls `endGame`).
- **Scoring**: `LINE_SCORES = [0, 100, 300, 500, 800]` × `level`; hard drop adds 2 pts/row dropped, soft drop 1 pt/row.
- **Level/speed**: level increases every 10 lines; `dropInterval = max(100, 1000 - (level-1)*90)` ms.
- **Rendering**: `draw()` clears and redraws grid + locked board + ghost piece (via `ghostY()`, alpha 0.2) + current piece each frame; `drawNext()` renders the preview canvas separately.
- **Input**: single `keydown` listener switches on `e.code` (arrows + `KeyX` rotate + `Space` hard drop); `KeyP` toggles pause independent of pause/game-over state.

To change board dimensions, update `COLS`/`ROWS`/`BLOCK` in `game.js` **and** the `<canvas id="board">` width/height in `index.html` to match (`COLS×BLOCK` by `ROWS×BLOCK`).
