function uid() {
  return `shot_${Math.random().toString(36).slice(2, 9)}`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function hexToRgb(color) {
  const fallback = { r: 255, g: 95, b: 46 };
  if (!color || typeof color !== "string") {
    return fallback;
  }

  const raw = color.replace(/^#/, "").trim();
  if (raw.length === 3) {
    const r = parseInt(raw[0] + raw[0], 16);
    const g = parseInt(raw[1] + raw[1], 16);
    const b = parseInt(raw[2] + raw[2], 16);
    if ([r, g, b].some((value) => Number.isNaN(value))) {
      return fallback;
    }
    return { r, g, b };
  }

  if (raw.length !== 6) {
    return fallback;
  }

  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  if ([r, g, b].some((value) => Number.isNaN(value))) {
    return fallback;
  }
  return { r, g, b };
}

function buildBrushCursor(diameter, color, mode) {
  const safeDiameter = clamp(diameter, 2, 72);
  const iconSize = Math.ceil(safeDiameter + 14);
  const center = iconSize / 2;
  const radius = safeDiameter / 2;
  const ringStroke = clamp(Math.round(Math.max(2, safeDiameter * 0.18)), 2, 4);

  const { r, g, b } = hexToRgb(color);
  const fillAlpha = mode === "highlight" ? 0.24 : mode === "pen" ? 0.12 : 0;
  const innerStroke = mode === "eraser" ? "#f8fafc" : color;
  const dash = mode === "eraser" ? ' stroke-dasharray="4 3"' : "";
  const fill = `rgba(${r}, ${g}, ${b}, ${fillAlpha})`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${iconSize}" height="${
    iconSize
  }" viewBox="0 0 ${iconSize} ${iconSize}"><circle cx="${center}" cy="${center}" r="${radius}" fill="${fill}" stroke="rgba(2, 10, 22, 0.92)" stroke-width="${
    ringStroke + 1
  }"/><circle cx="${center}" cy="${center}" r="${radius}" fill="none" stroke="${innerStroke}" stroke-width="${ringStroke}"${dash}/></svg>`;

  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${Math.round(
    center
  )} ${Math.round(center)}, crosshair`;
}

function isTextEditingElement(target) {
  if (!(target instanceof Element)) {
    return false;
  }

  const editable = target.closest("input, textarea, [contenteditable='true']");
  return Boolean(editable);
}

function formatMapCoordinates(mapCoordinates) {
  if (!mapCoordinates) {
    return "X: --, Y: --";
  }

  const formatValue = (value) => {
    if (!Number.isFinite(value)) {
      return "--";
    }
    return value.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
  };

  const x = formatValue(mapCoordinates.x);
  const y = formatValue(mapCoordinates.y);
  return `X: ${x}, Y: ${y}`;
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load screenshot image."));
    image.src = dataUrl;
  });
}

function clonePoint(point) {
  return { x: point.x, y: point.y };
}

function makeRect(start, end) {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    w: Math.abs(end.x - start.x),
    h: Math.abs(end.y - start.y)
  };
}

function drawStroke(ctx, action) {
  if (action.points.length < 2) {
    return;
  }

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = action.size;

  if (action.tool === "eraser") {
    ctx.globalCompositeOperation = "destination-out";
    ctx.strokeStyle = "rgba(0, 0, 0, 1)";
    ctx.globalAlpha = 1;
  } else if (action.tool === "highlight") {
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = action.color;
    ctx.globalAlpha = 0.23;
  } else {
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = action.color;
    ctx.globalAlpha = 1;
  }

  ctx.beginPath();
  ctx.moveTo(action.points[0].x, action.points[0].y);
  for (let i = 1; i < action.points.length; i += 1) {
    const point = action.points[i];
    ctx.lineTo(point.x, point.y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawRect(ctx, action) {
  const rect = makeRect(action.start, action.end);
  if (rect.w < 1 || rect.h < 1) {
    return;
  }
  ctx.save();
  ctx.strokeStyle = action.color;
  ctx.lineWidth = action.size;
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  ctx.restore();
}

function drawArrow(ctx, action) {
  const dx = action.end.x - action.start.x;
  const dy = action.end.y - action.start.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.5) {
    return;
  }

  const ux = dx / length;
  const uy = dy / length;
  const headLength = Math.max(10, action.size * 3.6);
  const headHalfWidth = Math.max(5, action.size * 1.9);
  const shaftLength = Math.max(0, length - headLength);
  const shaftEnd = {
    x: action.start.x + ux * shaftLength,
    y: action.start.y + uy * shaftLength
  };

  ctx.save();
  ctx.strokeStyle = action.color;
  ctx.fillStyle = action.color;
  ctx.lineWidth = action.size;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.beginPath();
  ctx.moveTo(action.start.x, action.start.y);
  ctx.lineTo(shaftEnd.x, shaftEnd.y);
  ctx.stroke();

  const left = {
    x: shaftEnd.x - uy * headHalfWidth,
    y: shaftEnd.y + ux * headHalfWidth
  };
  const right = {
    x: shaftEnd.x + uy * headHalfWidth,
    y: shaftEnd.y - ux * headHalfWidth
  };

  ctx.beginPath();
  ctx.moveTo(action.end.x, action.end.y);
  ctx.lineTo(left.x, left.y);
  ctx.lineTo(right.x, right.y);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function drawText(ctx, action) {
  ctx.save();
  ctx.fillStyle = action.color;
  ctx.font = `${Math.max(11, action.size * 3)}px "IBM Plex Sans", sans-serif`;
  ctx.textBaseline = "top";
  ctx.fillText(action.text, action.x, action.y);
  ctx.restore();
}

function drawAction(ctx, action) {
  if (action.kind === "stroke") {
    drawStroke(ctx, action);
    return;
  }
  if (action.kind === "rect") {
    drawRect(ctx, action);
    return;
  }
  if (action.kind === "arrow") {
    drawArrow(ctx, action);
    return;
  }
  if (action.kind === "text") {
    drawText(ctx, action);
  }
}

export class ScreenshotManager {
  constructor(listElement, templateElement) {
    this.listElement = listElement;
    this.templateElement = templateElement;
    this.items = [];
    this.onChange = () => {};
    this.activeItemId = null;

    window.addEventListener("keydown", (event) => {
      this.#handleGlobalShortcut(event);
    });

    window.addEventListener("resize", () => {
      for (const item of this.items) {
        this.renderPreview(item);
      }
    });
  }

  setOnChange(onChange) {
    this.onChange = onChange ?? (() => {});
  }

  notifyChange() {
    this.onChange();
  }

  clear() {
    this.items = [];
    this.listElement.innerHTML = "";
    this.activeItemId = null;
    this.notifyChange();
  }

  hasScreenshots() {
    return this.items.length > 0;
  }

  getNextTitle() {
    return `Screenshot ${this.items.length + 1}`;
  }

  async addFromDataUrl(
    dataUrl,
    title = this.getNextTitle(),
    preserved = null,
    mapCoordinates = null,
    options = {}
  ) {
    const { scrollIntoView = true } = options;
    const baseImage = await loadImage(dataUrl);
    const fragment = this.templateElement.content.cloneNode(true);
    const card = fragment.querySelector(".shot-card");
    const titleInput = fragment.querySelector(".shot-title");
    const coordinatesLabel = fragment.querySelector(".shot-coordinates");
    const notesInput = fragment.querySelector(".shot-notes");
    const canvas = fragment.querySelector(".shot-canvas");
    const wrap = fragment.querySelector(".shot-canvas-wrap");
    const toolButtons = Array.from(fragment.querySelectorAll(".anno-tool[data-tool]"));
    const undoBtn = fragment.querySelector(".anno-undo");
    const redoBtn = fragment.querySelector(".anno-redo");
    const deleteBtn = fragment.querySelector(".delete-shot");
    const moveUpBtn = fragment.querySelector(".move-up");
    const moveDownBtn = fragment.querySelector(".move-down");
    const colorInput = fragment.querySelector(".anno-color");
    const sizeInput = fragment.querySelector(".anno-size");

    titleInput.value = preserved?.title ?? title;
    notesInput.value = preserved?.notes ?? "";

    const annotationLayer = document.createElement("canvas");
    annotationLayer.width = baseImage.naturalWidth;
    annotationLayer.height = baseImage.naturalHeight;

    const item = {
      id: preserved?.id ?? uid(),
      titleInput,
      coordinatesLabel,
      notesInput,
      card,
      canvas,
      wrap,
      toolButtons,
      undoBtn,
      redoBtn,
      deleteBtn,
      moveUpBtn,
      moveDownBtn,
      colorInput,
      sizeInput,
      baseImage,
      dataUrl,
      width: baseImage.naturalWidth,
      height: baseImage.naturalHeight,
      annotationLayer,
      actions: preserved?.actions ? structuredClone(preserved.actions) : [],
      redoActions: [],
      mapCoordinates: mapCoordinates ?? preserved?.mapCoordinates ?? null,
      tool: preserved?.tool ?? "pen",
      color: preserved?.color ?? colorInput.value,
      size: preserved?.size ?? Number(sizeInput.value),
      draft: null,
      activePointerId: null
    };

    colorInput.value = item.color;
    sizeInput.value = String(item.size);
    coordinatesLabel.textContent = formatMapCoordinates(item.mapCoordinates);

    this.#attachCardEvents(item);
    this.#syncToolUi(item);
    this.listElement.append(fragment);
    this.items.push(item);
    this.renderPreview(item);
    this.#setActiveItem(item.id);

    if (scrollIntoView) {
      requestAnimationFrame(() => {
        this.listElement.scrollTo({
          top: this.listElement.scrollHeight,
          behavior: "smooth"
        });
      });
    }

    this.notifyChange();
    return item;
  }

  #attachCardEvents(item) {
    item.card.addEventListener("pointerdown", () => {
      this.#setActiveItem(item.id);
    });

    item.card.addEventListener("focusin", () => {
      this.#setActiveItem(item.id);
    });

    item.titleInput.addEventListener("input", () => {
      this.notifyChange();
    });
    item.notesInput.addEventListener("input", () => {
      this.notifyChange();
    });

    item.colorInput.addEventListener("input", () => {
      item.color = item.colorInput.value;
      this.#updateCanvasCursor(item);
      this.notifyChange();
    });

    item.sizeInput.addEventListener("input", () => {
      item.size = Number(item.sizeInput.value);
      this.#updateCanvasCursor(item);
      this.notifyChange();
    });

    item.toolButtons.forEach((button) => {
      button.addEventListener("click", () => {
        if (!button.dataset.tool) {
          return;
        }
        item.tool = button.dataset.tool;
        this.#syncToolUi(item);
        this.#updateCanvasCursor(item);
        this.notifyChange();
      });
    });

    item.undoBtn.addEventListener("click", () => {
      this.#setActiveItem(item.id);
      this.#undoItem(item);
    });

    item.redoBtn.addEventListener("click", () => {
      this.#setActiveItem(item.id);
      this.#redoItem(item);
    });

    item.deleteBtn.addEventListener("click", () => {
      const index = this.items.findIndex((it) => it.id === item.id);
      if (index === -1) {
        return;
      }
      this.items.splice(index, 1);
      item.card.remove();

      if (this.activeItemId === item.id) {
        const replacement = this.items[Math.min(index, this.items.length - 1)] ?? null;
        this.activeItemId = replacement?.id ?? null;
      }

      this.notifyChange();
    });

    item.moveUpBtn.addEventListener("click", () => {
      this.moveItem(item.id, -1);
    });

    item.moveDownBtn.addEventListener("click", () => {
      this.moveItem(item.id, 1);
    });

    item.canvas.addEventListener("pointerdown", (event) => {
      this.#startDrawing(item, event);
    });

    item.canvas.addEventListener("pointermove", (event) => {
      this.#updateDrawing(item, event);
    });

    item.canvas.addEventListener("pointerup", (event) => {
      this.#finishDrawing(item, event);
    });

    item.canvas.addEventListener("pointercancel", (event) => {
      this.#cancelDrawing(item, event);
    });
  }

  #syncToolUi(item) {
    item.toolButtons.forEach((button) => {
      if (button.dataset.tool === item.tool) {
        button.classList.add("is-active");
      } else {
        button.classList.remove("is-active");
      }
    });
  }

  #setActiveItem(id) {
    this.activeItemId = id;
  }

  #undoItem(item) {
    const last = item.actions.pop();
    if (!last) {
      return false;
    }
    item.redoActions.push(last);
    this.renderPreview(item);
    this.notifyChange();
    return true;
  }

  #redoItem(item) {
    const next = item.redoActions.pop();
    if (!next) {
      return false;
    }
    item.actions.push(next);
    this.renderPreview(item);
    this.notifyChange();
    return true;
  }

  #getActiveItem() {
    if (!this.activeItemId) {
      return this.items[this.items.length - 1] ?? null;
    }
    return this.items.find((item) => item.id === this.activeItemId) ?? null;
  }

  #handleGlobalShortcut(event) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) {
      return;
    }
    if (isTextEditingElement(event.target)) {
      return;
    }

    const activeItem = this.#getActiveItem();
    if (!activeItem) {
      return;
    }

    const key = event.key.toLowerCase();
    const wantsUndo = key === "z" && !event.shiftKey;
    const wantsRedo = key === "y" || (key === "z" && event.shiftKey);

    if (wantsUndo) {
      if (this.#undoItem(activeItem)) {
        event.preventDefault();
      }
      return;
    }

    if (wantsRedo) {
      if (this.#redoItem(activeItem)) {
        event.preventDefault();
      }
    }
  }

  #updateCanvasCursor(item) {
    if (!item?.canvas) {
      return;
    }

    if (item.tool === "text") {
      item.canvas.style.cursor = "text";
      return;
    }

    if (item.tool === "arrow") {
      item.canvas.style.cursor = "crosshair";
      return;
    }

    if (item.tool === "rect") {
      item.canvas.style.cursor = "crosshair";
      return;
    }

    const displayScale =
      item.width > 0 && item.canvas.clientWidth > 0 ? item.canvas.clientWidth / item.width : 1;
    const displaySize = clamp(item.size * displayScale, 2, 72);

    if (item.tool === "pen") {
      item.canvas.style.cursor = buildBrushCursor(displaySize, item.color, "pen");
      return;
    }

    if (item.tool === "highlight") {
      item.canvas.style.cursor = buildBrushCursor(displaySize, item.color, "highlight");
      return;
    }

    if (item.tool === "eraser") {
      item.canvas.style.cursor = buildBrushCursor(displaySize, item.color, "eraser");
      return;
    }

    item.canvas.style.cursor = "crosshair";
  }

  #canvasPoint(item, event) {
    const rect = item.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return { x: 0, y: 0 };
    }
    const x = ((event.clientX - rect.left) / rect.width) * item.width;
    const y = ((event.clientY - rect.top) / rect.height) * item.height;
    return {
      x: Math.max(0, Math.min(item.width, x)),
      y: Math.max(0, Math.min(item.height, y))
    };
  }

  #startDrawing(item, event) {
    const point = this.#canvasPoint(item, event);

    if (item.tool === "text") {
      const text = window.prompt("Text label:");
      if (!text) {
        return;
      }
      item.actions.push({
        kind: "text",
        color: item.color,
        size: item.size,
        x: point.x,
        y: point.y,
        text
      });
      item.redoActions = [];
      this.renderPreview(item);
      this.notifyChange();
      return;
    }

    item.canvas.setPointerCapture(event.pointerId);
    item.activePointerId = event.pointerId;

    if (["pen", "highlight", "eraser"].includes(item.tool)) {
      item.draft = {
        kind: "stroke",
        tool: item.tool,
        color: item.color,
        size: item.size,
        points: [point]
      };
    } else if (item.tool === "arrow") {
      item.draft = {
        kind: "arrow",
        color: item.color,
        size: item.size,
        start: point,
        end: point
      };
    } else if (item.tool === "rect") {
      item.draft = {
        kind: "rect",
        color: item.color,
        size: item.size,
        start: point,
        end: point
      };
    }

    this.renderPreview(item, item.draft);
    event.preventDefault();
  }

  #updateDrawing(item, event) {
    if (!item.draft || item.activePointerId !== event.pointerId) {
      return;
    }
    const point = this.#canvasPoint(item, event);

    if (item.draft.kind === "stroke") {
      item.draft.points.push(point);
    } else {
      item.draft.end = point;
    }

    this.renderPreview(item, item.draft);
    event.preventDefault();
  }

  #finishDrawing(item, event) {
    if (!item.draft || item.activePointerId !== event.pointerId) {
      return;
    }

    if (item.canvas.hasPointerCapture(event.pointerId)) {
      item.canvas.releasePointerCapture(event.pointerId);
    }

    const draft = item.draft;
    item.draft = null;
    item.activePointerId = null;

    if (draft.kind === "stroke" && draft.points.length < 2) {
      this.renderPreview(item);
      return;
    }

    if (draft.kind !== "stroke") {
      const rect = makeRect(draft.start, draft.end);
      if (rect.w < 2 && rect.h < 2) {
        this.renderPreview(item);
        return;
      }
    }

    item.actions.push(draft);
    item.redoActions = [];
    this.renderPreview(item);
    this.notifyChange();
    event.preventDefault();
  }

  #cancelDrawing(item, event) {
    if (!item.draft || item.activePointerId !== event.pointerId) {
      return;
    }

    item.draft = null;
    item.activePointerId = null;
    this.renderPreview(item);
    event.preventDefault();
  }

  moveItem(id, direction) {
    const index = this.items.findIndex((item) => item.id === id);
    if (index === -1) {
      return;
    }

    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= this.items.length) {
      return;
    }

    const [item] = this.items.splice(index, 1);
    this.items.splice(targetIndex, 0, item);

    if (direction < 0) {
      this.listElement.insertBefore(item.card, this.listElement.children[targetIndex]);
    } else {
      const sibling = this.listElement.children[targetIndex + 1] ?? null;
      this.listElement.insertBefore(item.card, sibling);
    }

    this.notifyChange();
  }

  #paintAnnotationLayer(item, preview = null) {
    const ctx = item.annotationLayer.getContext("2d", { alpha: true });
    ctx.clearRect(0, 0, item.annotationLayer.width, item.annotationLayer.height);

    for (const action of item.actions) {
      drawAction(ctx, action);
    }

    if (preview) {
      drawAction(ctx, preview);
    }
  }

  renderPreview(item, preview = null) {
    this.#paintAnnotationLayer(item, preview);

    const maxWidth = Math.max(120, item.wrap.clientWidth - 2);
    const scale = Math.min(1.2, maxWidth / item.width);
    const displayWidth = Math.max(1, Math.round(item.width * scale));
    const displayHeight = Math.max(1, Math.round(item.height * scale));
    const dpr = window.devicePixelRatio || 1;

    item.canvas.width = Math.round(displayWidth * dpr);
    item.canvas.height = Math.round(displayHeight * dpr);
    item.canvas.style.width = `${displayWidth}px`;
    item.canvas.style.height = `${displayHeight}px`;

    const ctx = item.canvas.getContext("2d", { alpha: true });
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, displayWidth, displayHeight);

    ctx.drawImage(item.baseImage, 0, 0, displayWidth, displayHeight);
    ctx.drawImage(item.annotationLayer, 0, 0, displayWidth, displayHeight);
    this.#updateCanvasCursor(item);
  }

  getSerializableProject() {
    return this.items.map((item) => ({
      id: item.id,
      title: item.titleInput.value.trim() || "Screenshot",
      mapCoordinates: item.mapCoordinates,
      notes: item.notesInput.value,
      imageDataUrl: item.dataUrl,
      actions: structuredClone(item.actions),
      tool: item.tool,
      color: item.color,
      size: item.size
    }));
  }

  async loadSerializableProject(screenshots) {
    this.clear();
    for (const shot of screenshots) {
      await this.addFromDataUrl(shot.imageDataUrl, shot.title || "Screenshot", shot, null, {
        scrollIntoView: false
      });
    }

    this.listElement.scrollTop = 0;
  }

  getFlattenedCanvas(item) {
    this.#paintAnnotationLayer(item);
    const out = document.createElement("canvas");
    out.width = item.width;
    out.height = item.height;
    const ctx = out.getContext("2d", { alpha: true });
    ctx.drawImage(item.baseImage, 0, 0);
    ctx.drawImage(item.annotationLayer, 0, 0);
    return out;
  }

  getExportData() {
    return this.items.map((item) => ({
      title: item.titleInput.value.trim() || "Screenshot",
      mapCoordinates: item.mapCoordinates,
      notes: item.notesInput.value,
      imageCanvas: this.getFlattenedCanvas(item)
    }));
  }
}
