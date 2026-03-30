function roundedPath(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawRoundedFill(ctx, x, y, w, h, r, fillStyle, strokeStyle = null) {
  roundedPath(ctx, x, y, w, h, r);
  ctx.fillStyle = fillStyle;
  ctx.fill();
  if (strokeStyle) {
    ctx.strokeStyle = strokeStyle;
    ctx.stroke();
  }
}

function drawImageCover(ctx, image, x, y, w, h) {
  const scale = Math.max(w / image.width, h / image.height);
  const drawW = image.width * scale;
  const drawH = image.height * scale;
  const drawX = x + (w - drawW) / 2;
  const drawY = y + (h - drawH) / 2;
  ctx.drawImage(image, drawX, drawY, drawW, drawH);
}

function formatCoordinatesForCard(mapCoordinates) {
  if (!mapCoordinates) {
    return "X: --, Y: --";
  }

  const formatValue = (value) => {
    if (!Number.isFinite(value)) {
      return "--";
    }
    return value
      .toFixed(2)
      .replace(/\.00$/, "")
      .replace(/(\.\d)0$/, "$1");
  };

  const x = formatValue(mapCoordinates.x);
  const y = formatValue(mapCoordinates.y);
  return `X: ${x}, Y: ${y}`;
}

function wrapText(ctx, text, maxWidth) {
  const clean = (text || "").replace(/\r\n/g, "\n").trim();
  if (!clean) {
    return [];
  }

  const paragraphs = clean.split("\n");
  const lines = [];

  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) {
      lines.push("");
      continue;
    }

    const words = paragraph.split(/\s+/);
    let line = words[0] ?? "";
    for (let i = 1; i < words.length; i += 1) {
      const candidate = `${line} ${words[i]}`;
      if (ctx.measureText(candidate).width <= maxWidth) {
        line = candidate;
      } else {
        lines.push(line);
        line = words[i];
      }
    }
    lines.push(line);
  }

  return lines;
}

function calcLayout(ctx, shots, width) {
  const pagePadX = 70;
  const headerTop = 30;
  const headerCardH = 124;
  const cardGap = 24;
  const cardPad = 24;
  const contentGap = 30;
  const cardInnerW = width - pagePadX * 2 - cardPad * 2;
  const imageColW = Math.round(cardInnerW * 0.64);
  const textColW = cardInnerW - imageColW - contentGap;
  const imageFrameH = 540;
  const footerH = 70;

  ctx.font = '500 30px "IBM Plex Sans", sans-serif';

  const cards = shots.map((shot) => {
    const noteLines = wrapText(ctx, shot.notes, textColW - 36);
    const noteLineHeight = 38;
    const notesH =
      70 + Math.max(noteLineHeight, noteLines.length * noteLineHeight) + 28;

    const titleH = 88;
    const rowH = Math.max(imageFrameH, notesH) + titleH + cardPad * 2;

    return {
      shot,
      noteLines,
      noteLineHeight,
      notesH,
      imageFrameH,
      rowH,
      titleH,
    };
  });

  const cardsStartY = headerTop + headerCardH + cardGap;
  const bodyHeight = cards.reduce((sum, card) => sum + card.rowH + cardGap, 0);
  const totalHeight = cardsStartY + bodyHeight + footerH;

  return {
    pagePadX,
    headerTop,
    headerCardH,
    cardsStartY,
    cardGap,
    cardPad,
    contentGap,
    imageColW,
    textColW,
    footerH,
    cards,
    totalHeight,
  };
}

export function buildReportCanvas(mapName, shots) {
  const width = 1600;
  const scratch = document.createElement("canvas");
  scratch.width = width;
  scratch.height = 100;
  const scratchCtx = scratch.getContext("2d");
  const layout = calcLayout(scratchCtx, shots, width);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = layout.totalHeight;
  const ctx = canvas.getContext("2d", { alpha: true });

  drawRoundedFill(
    ctx,
    layout.pagePadX,
    layout.headerTop,
    width - layout.pagePadX * 2,
    layout.headerCardH,
    18,
    "#3a3e45",
    "#4c515b",
  );

  ctx.fillStyle = "#f2f3f5";
  ctx.font = '700 58px "Space Grotesk", sans-serif';
  ctx.fillText(
    mapName || "Untitled Map",
    layout.pagePadX + 28,
    layout.headerTop + 56,
  );

  ctx.fillStyle = "#b5bac1";
  ctx.font = '500 29px "IBM Plex Sans", sans-serif';
  ctx.fillText(
    `${shots.length} screenshot${shots.length === 1 ? "" : "s"} • Generated ${new Date().toLocaleString()}`,
    layout.pagePadX + 28,
    layout.headerTop + 96,
  );

  let y = layout.cardsStartY;
  for (const card of layout.cards) {
    const x = layout.pagePadX;
    const widthCard = width - layout.pagePadX * 2;

    drawRoundedFill(ctx, x, y, widthCard, card.rowH, 18, "#3a3e45", "#4c515b");

    ctx.fillStyle = "#f2f3f5";
    ctx.font = '700 40px "Space Grotesk", sans-serif';
    ctx.fillText(card.shot.title, x + layout.cardPad, y + 48);

    ctx.fillStyle = "#b5bac1";
    ctx.font = '500 24px "IBM Plex Sans", sans-serif';
    ctx.fillText(
      formatCoordinatesForCard(card.shot.mapCoordinates),
      x + layout.cardPad,
      y + 82,
    );

    const contentTop = y + card.titleH + layout.cardPad;
    const imageX = x + layout.cardPad;
    const imageY = contentTop;
    const imageW = layout.imageColW;
    const imageH = card.imageFrameH;

    drawRoundedFill(
      ctx,
      imageX - 2,
      imageY - 2,
      imageW + 4,
      imageH + 4,
      14,
      "#4c515a",
    );
    ctx.save();
    roundedPath(ctx, imageX, imageY, imageW, imageH, 12);
    ctx.clip();

    const frameGradient = ctx.createLinearGradient(
      imageX,
      imageY,
      imageX,
      imageY + imageH,
    );
    frameGradient.addColorStop(0, "#32363d");
    frameGradient.addColorStop(1, "#2b2f36");
    ctx.fillStyle = frameGradient;
    ctx.fillRect(imageX, imageY, imageW, imageH);

    drawImageCover(ctx, card.shot.imageCanvas, imageX, imageY, imageW, imageH);

    ctx.restore();

    const notesX = imageX + layout.imageColW + layout.contentGap;
    const notesY = contentTop;
    const notesW = layout.textColW;
    const notesH = Math.max(card.notesH, card.imageFrameH);
    drawRoundedFill(
      ctx,
      notesX,
      notesY,
      notesW,
      notesH,
      14,
      "#2f333a",
      "#454b54",
    );

    ctx.fillStyle = "#c4c9d2";
    ctx.font = '600 26px "IBM Plex Sans", sans-serif';
    ctx.fillText("Notes", notesX + 18, notesY + 38);

    ctx.fillStyle = "#edf0f3";
    ctx.font = '500 30px "IBM Plex Sans", sans-serif';
    const lines = card.noteLines.length
      ? card.noteLines
      : ["No additional notes."];
    let lineY = notesY + 84;
    for (const line of lines) {
      ctx.fillText(line, notesX + 18, lineY);
      lineY += card.noteLineHeight;
    }

    y += card.rowH + layout.cardGap;
  }

  const footerY = layout.totalHeight - layout.footerH + 26;
  ctx.fillStyle = "#9aa0ab";
  ctx.font = '500 20px "IBM Plex Sans", sans-serif';
  ctx.fillText(
    "https://wtfseanscool.github.io/kog-testing-assistant/ • by CAKExSNIFFERx42",
    layout.pagePadX,
    footerY,
  );

  return canvas;
}

export function downloadCanvasPng(canvas, fileName) {
  const anchor = document.createElement("a");
  anchor.href = canvas.toDataURL("image/png");
  anchor.download = fileName;
  anchor.click();
}
