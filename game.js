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
const recordsBtn = document.getElementById('records-btn');
const leaderboardPanel = document.getElementById('leaderboard-panel');
const runStatsEl = document.getElementById('run-stats');
const saveScoreForm = document.getElementById('save-score-form');
const nameInput = document.getElementById('name-input');
const saveScoreBtn = document.getElementById('save-score-btn');
const leaderboardList = document.getElementById('leaderboard-list');
const resetRecordsBtn = document.getElementById('reset-records-btn');
const closeRecordsBtn = document.getElementById('close-records-btn');

const HIGHSCORES_KEY = 'tetris-highscores';
const MAX_HIGHSCORES = 5;

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let bestCombo = 0;
let recordsAutoPaused = false;
let scoreSaved = false;

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
    if (cleared > bestCombo) bestCombo = cleared;
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

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
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
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function getHighScores() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HIGHSCORES_KEY));
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function setHighScores(list) {
  localStorage.setItem(HIGHSCORES_KEY, JSON.stringify(list));
}

function qualifiesForLeaderboard(s) {
  const list = getHighScores();
  if (list.length < MAX_HIGHSCORES) return true;
  return s > list[list.length - 1].score;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderLeaderboard(highlightIdx) {
  const list = getHighScores();
  leaderboardList.innerHTML = '';
  if (!list.length) {
    const li = document.createElement('li');
    li.className = 'leaderboard-empty';
    li.textContent = 'Sin récords todavía';
    leaderboardList.appendChild(li);
    return;
  }
  list.forEach((entry, i) => {
    const li = document.createElement('li');
    if (i === highlightIdx) li.classList.add('highlight');
    li.innerHTML =
      `<span class="lb-rank">${i + 1}</span>` +
      `<span class="lb-name">${escapeHtml(entry.name)}</span>` +
      `<span class="lb-score">${entry.score.toLocaleString()}</span>` +
      `<span class="lb-meta">x${entry.combo} · ${entry.lines}L</span>`;
    leaderboardList.appendChild(li);
  });
}

function saveScore(name) {
  const list = getHighScores();
  const entry = { name: name || 'Jugador', score, combo: bestCombo, lines };
  list.push(entry);
  list.sort((a, b) => b.score - a.score);
  list.length = Math.min(list.length, MAX_HIGHSCORES);
  setHighScores(list);
  const idx = list.indexOf(entry);
  renderLeaderboard(idx);
  saveScoreForm.classList.remove('visible');
  scoreSaved = true;
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');

  restartBtn.style.display = '';
  closeRecordsBtn.classList.remove('visible');
  runStatsEl.textContent = `Mejor combo: x${bestCombo} · Líneas: ${lines}`;
  leaderboardPanel.classList.add('visible');

  if (!scoreSaved && qualifiesForLeaderboard(score)) {
    nameInput.value = '';
    saveScoreForm.classList.add('visible');
  } else {
    saveScoreForm.classList.remove('visible');
  }
  renderLeaderboard();
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
    leaderboardPanel.classList.remove('visible');
    overlay.classList.remove('hidden');
  }
}

function openRecords() {
  if (!gameOver && !paused) {
    paused = true;
    cancelAnimationFrame(animId);
    recordsAutoPaused = true;
  } else {
    recordsAutoPaused = false;
  }
  overlayTitle.textContent = 'RÉCORDS';
  overlayScore.textContent = '';
  runStatsEl.textContent = '';
  restartBtn.style.display = gameOver ? '' : 'none';
  saveScoreForm.classList.remove('visible');
  closeRecordsBtn.classList.add('visible');
  leaderboardPanel.classList.add('visible');
  renderLeaderboard();
  overlay.classList.remove('hidden');
}

function closeRecords() {
  closeRecordsBtn.classList.remove('visible');
  restartBtn.style.display = '';
  if (gameOver) {
    // return to game-over view instead of fully closing
    endGame();
    return;
  }
  leaderboardPanel.classList.remove('visible');
  if (recordsAutoPaused) {
    recordsAutoPaused = false;
    overlay.classList.add('hidden');
    paused = false;
    lastTime = performance.now();
    loop(lastTime);
  } else if (paused) {
    // was already paused before opening records; return to the pause overlay
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
  } else {
    overlay.classList.add('hidden');
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
  bestCombo = 0;
  scoreSaved = false;
  dropInterval = 1000;
  dropAccum = 0;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  leaderboardPanel.classList.remove('visible');
  saveScoreForm.classList.remove('visible');
  closeRecordsBtn.classList.remove('visible');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
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

recordsBtn.addEventListener('click', openRecords);
closeRecordsBtn.addEventListener('click', closeRecords);

saveScoreBtn.addEventListener('click', () => {
  const name = nameInput.value.trim().slice(0, 12);
  saveScore(name);
});

nameInput.addEventListener('keydown', e => {
  if (e.code === 'Enter') saveScoreBtn.click();
});

resetRecordsBtn.addEventListener('click', () => {
  if (confirm('¿Borrar todos los récords?')) {
    localStorage.removeItem(HIGHSCORES_KEY);
    renderLeaderboard();
  }
});

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

init();
