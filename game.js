'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#90caf9', // J - pale blue
  '#ffb74d', // L - orange
  '#b0bec5', // NUT - metallic gray
  '#ff2fd4', // POWERUP - magenta neón
  '#f8bbd0', // CROSS - rosa pálido
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
  [[8,8,8],[8,0,8],[8,8,8]],                  // NUT - hueco central
  [[9]],                                        // POWERUP - bloque 1x1 (destruye área 3x3)
  [[0,10,0],[10,10,10],[0,10,0]],             // CROSS - forma de cruz
];

const LINE_SCORES = [0, 100, 300, 500, 800];
const POWERUP_TYPE = 9;
const POWERUP_MIN_LINES = 3;

const PASTEL_COLORS = [
  null,
  '#80deea', // I
  '#ffe082', // O - darker than white board bg so it stays visible in light theme
  '#e1bee7', // T
  '#c8e6c9', // S
  '#ffcdd2', // Z
  '#bbdefb', // J
  '#ffe0b2', // L
  '#b0bec5', // NUT - darker than white board bg so it stays visible in light theme
  '#f8bbd0', // POWERUP
  '#fce4ec', // CROSS
];

const SKINS = ['retro', 'neon', 'pastel', 'pixel'];
let currentSkin = 'retro';

const GRID_COLORS = { dark: '#22222e', light: '#e0e0ea' };
let gridColor = GRID_COLORS.dark;

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const themeToggle = document.getElementById('theme-toggle');

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const NUT_CHANCE = 0.06;
  const POWERUP_CHANCE = 0.03;
  const CROSS_CHANCE = 0.06;
  let type;
  if (lines >= POWERUP_MIN_LINES && Math.random() < POWERUP_CHANCE) {
    type = POWERUP_TYPE;
  } else if (Math.random() < NUT_CHANCE) {
    type = 8;
  } else if (Math.random() < CROSS_CHANCE) {
    type = 10;
  } else {
    type = Math.floor(Math.random() * 7) + 1;
  }
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    updateHUD();
  }
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  if (current.type === POWERUP_TYPE) {
    destroyArea();
  } else {
    merge();
  }
  clearLines();
  spawn();
}

function destroyArea() {
  // la pieza misma nunca se mergea al board, así que ya queda destruida.
  // buscamos las celdas del stack que la pieza toca al aterrizar.
  const NEIGHBORS = [[0, 1], [0, -1], [1, 0], [-1, 0]];
  const contacts = [];
  for (let r = 0; r < current.shape.length; r++) {
    for (let c = 0; c < current.shape[r].length; c++) {
      if (!current.shape[r][c]) continue;
      const px = current.x + c, py = current.y + r;
      for (const [dx, dy] of NEIGHBORS) {
        const nx = px + dx, ny = py + dy;
        if (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS && board[ny][nx]) {
          contacts.push([nx, ny]);
        }
      }
    }
  }
  if (!contacts.length) return;

  const countAt = (cx, cy) => {
    let count = 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS && board[ny][nx]) count++;
      }
    return count;
  };

  // elegimos el centro 3x3 que maximiza los bloques del stack destruidos
  let best = contacts[0], bestCount = countAt(best[0], best[1]);
  for (const [cx, cy] of contacts) {
    const count = countAt(cx, cy);
    if (count > bestCount) { bestCount = count; best = [cx, cy]; }
  }

  const [bx, by] = best;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const nx = bx + dx, ny = by + dy;
      if (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS) board[ny][nx] = 0;
    }
}

function spawn() {
  current = next;
  next = randomPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

function roundedRectPath(context, x, y, w, h, r) {
  if (typeof context.roundRect === 'function') {
    context.beginPath();
    context.roundRect(x, y, w, h, r);
    return;
  }
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + w, y, x + w, y + h, r);
  context.arcTo(x + w, y + h, x, y + h, r);
  context.arcTo(x, y + h, x, y, r);
  context.arcTo(x, y, x + w, y, r);
  context.closePath();
}

function drawBlockRetro(context, x, y, colorIndex, size, isGhost) {
  context.fillStyle = COLORS[colorIndex];
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  if (isGhost) return;
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
}

function drawBlockNeon(context, x, y, colorIndex, size, isGhost) {
  const color = COLORS[colorIndex];
  context.save();
  context.shadowColor = color;
  context.shadowBlur = size * 0.6;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  context.restore();
  if (isGhost) return;
  context.fillStyle = 'rgba(255,255,255,0.25)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 3);
}

function drawBlockPastel(context, x, y, colorIndex, size, isGhost) {
  const color = PASTEL_COLORS[colorIndex];
  const px = x * size + 1;
  const py = y * size + 1;
  const w = size - 2;
  const h = size - 2;
  const r = Math.max(2, size * 0.2);
  context.fillStyle = color;
  roundedRectPath(context, px, py, w, h, r);
  context.fill();
  // outline so pastel blocks stay visible against a white/light board background
  context.strokeStyle = 'rgba(0,0,0,0.25)';
  context.lineWidth = 1;
  roundedRectPath(context, px, py, w, h, r);
  context.stroke();
  if (isGhost) return;
  context.fillStyle = 'rgba(255,255,255,0.35)';
  roundedRectPath(context, px, py, w, Math.max(3, h * 0.3), r);
  context.fill();
}

function drawBlockPixel(context, x, y, colorIndex, size, isGhost) {
  const color = COLORS[colorIndex];
  const px = x * size + 1;
  const py = y * size + 1;
  const w = size - 2;
  const h = size - 2;
  context.fillStyle = color;
  context.fillRect(px, py, w, h);
  if (isGhost) return;
  const cols = 3;
  const cellW = w / cols;
  const cellH = h / cols;
  for (let ry = 0; ry < cols; ry++) {
    for (let rx = 0; rx < cols; rx++) {
      context.fillStyle = (rx + ry) % 2 === 0 ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)';
      context.fillRect(px + rx * cellW, py + ry * cellH, cellW, cellH);
    }
  }
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  context.globalAlpha = alpha ?? 1;
  // ghost pieces skip decorative highlight/texture passes: at low alpha those
  // extra passes compound with globalAlpha and become invisible noise instead
  // of a clean silhouette (e.g. pixel skin's full-block checker texture).
  const isGhost = (alpha ?? 1) < 1;
  switch (currentSkin) {
    case 'neon':
      drawBlockNeon(context, x, y, colorIndex, size, isGhost);
      break;
    case 'pastel':
      drawBlockPastel(context, x, y, colorIndex, size, isGhost);
      break;
    case 'pixel':
      drawBlockPixel(context, x, y, colorIndex, size, isGhost);
      break;
    default:
      drawBlockRetro(context, x, y, colorIndex, size, isGhost);
  }
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (currentSkin === 'neon') {
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  if (currentSkin === 'neon') {
    nextCtx.fillStyle = '#050505';
    nextCtx.fillRect(0, 0, nextCanvas.width, nextCanvas.height);
  }
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  draw();
  if (gameOver) return;
  animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (skinSelectorOpen) return;
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);

function setTheme(theme) {
  document.body.classList.toggle('light-theme', theme === 'light');
  gridColor = theme === 'light' ? GRID_COLORS.light : GRID_COLORS.dark;
  localStorage.setItem('theme', theme);
}

themeToggle.addEventListener('mousedown', e => e.preventDefault());

themeToggle.addEventListener('click', () => {
  const theme = document.body.classList.contains('light-theme') ? 'dark' : 'light';
  setTheme(theme);
});

setTheme(localStorage.getItem('theme') === 'light' ? 'light' : 'dark');

const skinToggle = document.getElementById('skin-toggle');
const skinSelector = document.getElementById('skin-selector');
const skinSelectorClose = document.getElementById('skin-selector-close');
const skinOptions = document.querySelectorAll('.skin-option');

let skinSelectorOpen = false;
let autoPausedForSkin = false;

function setActiveSkinOption(skin) {
  skinOptions.forEach(btn => btn.classList.toggle('active', btn.dataset.skin === skin));
}

function setSkin(skin) {
  if (!SKINS.includes(skin)) return;
  currentSkin = skin;
  localStorage.setItem('tetris-skin', skin);
  setActiveSkinOption(skin);
  draw();
  drawNext();
}

const savedSkin = localStorage.getItem('tetris-skin');
currentSkin = SKINS.includes(savedSkin) ? savedSkin : 'retro';
setActiveSkinOption(currentSkin);

function openSkinSelector() {
  skinSelector.classList.remove('hidden');
  skinSelectorOpen = true;
  if (!paused && !gameOver) {
    autoPausedForSkin = true;
    cancelAnimationFrame(animId);
  }
}

function closeSkinSelector() {
  skinSelector.classList.add('hidden');
  skinSelectorOpen = false;
  if (autoPausedForSkin) {
    autoPausedForSkin = false;
    lastTime = performance.now();
    animId = requestAnimationFrame(loop);
  }
}

if (skinToggle) {
  skinToggle.addEventListener('mousedown', e => e.preventDefault());
  skinToggle.addEventListener('click', () => {
    // Don't let the skin panel cover the pause/game-over overlay or its buttons.
    if (paused || gameOver) return;
    if (skinSelectorOpen) closeSkinSelector();
    else openSkinSelector();
  });
}

if (skinSelectorClose) {
  skinSelectorClose.addEventListener('click', closeSkinSelector);
}

skinOptions.forEach(btn => {
  btn.addEventListener('click', () => setSkin(btn.dataset.skin));
});

init();
