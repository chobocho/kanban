// Export the current board to a PNG using the Canvas API only (no html2canvas
// or any other external library). The board's structured data lets us draw it
// deterministically at high resolution, which also looks crisp on foldable
// large-screen devices.

import { Board } from './types.js';

interface Metrics {
  pad: number;
  colWidth: number;
  colGap: number;
  headerH: number;
  cardMinH: number;
  cardGap: number;
  cardPad: number;
  titleH: number;
  lineH: number;
  font: string;
  headerFont: string;
  titleFont: string;
  radius: number;
}

const M: Metrics = {
  pad: 24,
  colWidth: 260,
  colGap: 16,
  headerH: 40,
  cardMinH: 40,
  cardGap: 10,
  cardPad: 12,
  titleH: 48,
  lineH: 20,
  font: '14px sans-serif',
  headerFont: 'bold 15px sans-serif',
  titleFont: 'bold 22px sans-serif',
  radius: 8,
};

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Split text into lines that fit within maxWidth for the current ctx font. */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const rawLine of text.split('\n')) {
    let line = '';
    for (const ch of rawLine) {
      if (ctx.measureText(line + ch).width > maxWidth && line !== '') {
        lines.push(line);
        line = ch;
      } else {
        line += ch;
      }
    }
    lines.push(line);
  }
  return lines.length > 0 ? lines : [''];
}

/** Measure the rendered height of a card given its text. */
function cardHeight(ctx: CanvasRenderingContext2D, text: string): number {
  ctx.font = M.font;
  const lines = wrapText(ctx, text, M.colWidth - M.cardPad * 2);
  return Math.max(M.cardMinH, M.cardPad * 2 + lines.length * M.lineH);
}

/**
 * Render the board to a canvas and return it. Uses a devicePixelRatio scale so
 * the image is sharp on high-density and foldable displays.
 */
export function renderBoardToCanvas(board: Board, scale = 2): HTMLCanvasElement {
  const probe = document.createElement('canvas').getContext('2d')!;

  // First pass: compute the total height needed.
  let maxColHeight = 0;
  for (const column of board.columns) {
    let h = M.headerH + M.cardGap;
    for (const card of column.cards) {
      h += cardHeight(probe, card.text) + M.cardGap;
    }
    maxColHeight = Math.max(maxColHeight, h);
  }
  const colCount = Math.max(board.columns.length, 1);
  const width = M.pad * 2 + colCount * M.colWidth + (colCount - 1) * M.colGap;
  const height = M.pad * 2 + M.titleH + maxColHeight + M.pad;

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);

  // Background: the board's own color, or the app's default theme color.
  ctx.fillStyle = board.background || '#0d6efd';
  ctx.fillRect(0, 0, width, height);

  // Board title.
  ctx.fillStyle = '#ffffff';
  ctx.font = M.titleFont;
  ctx.textBaseline = 'top';
  ctx.fillText(board.name, M.pad, M.pad);

  // Columns.
  const top = M.pad + M.titleH;
  board.columns.forEach((column, index) => {
    const x = M.pad + index * (M.colWidth + M.colGap);

    // Column background.
    let colH = M.headerH + M.cardGap;
    for (const card of column.cards) colH += cardHeight(ctx, card.text) + M.cardGap;
    ctx.fillStyle = '#ebecf0';
    roundRect(ctx, x, top, M.colWidth, colH, M.radius);
    ctx.fill();

    // Column header.
    ctx.fillStyle = '#172b4d';
    ctx.font = M.headerFont;
    ctx.fillText(column.title, x + M.cardPad, top + 12, M.colWidth - M.cardPad * 2);

    // Cards.
    let cy = top + M.headerH;
    for (const card of column.cards) {
      const ch = cardHeight(ctx, card.text);
      ctx.fillStyle = '#ffffff';
      roundRect(ctx, x + M.cardGap, cy, M.colWidth - M.cardGap * 2, ch, M.radius);
      ctx.fill();
      if (card.color) {
        ctx.fillStyle = card.color;
        roundRect(ctx, x + M.cardGap, cy, 6, ch, 3);
        ctx.fill();
      }
      ctx.fillStyle = '#172b4d';
      ctx.font = M.font;
      const lines = wrapText(ctx, card.text, M.colWidth - M.cardGap * 2 - M.cardPad * 2);
      lines.forEach((line, i) => {
        ctx.fillText(line, x + M.cardGap + M.cardPad, cy + M.cardPad + i * M.lineH);
      });
      cy += ch + M.cardGap;
    }
  });

  return canvas;
}

/** Trigger a browser download of the board as a PNG file. */
export function exportBoardPng(board: Board): void {
  const canvas = renderBoardToCanvas(board);
  const url = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = `${board.name || 'board'}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
