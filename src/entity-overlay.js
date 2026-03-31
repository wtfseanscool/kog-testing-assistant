const CUSTOM_ENTITIES_STORAGE_KEY = "kog-testing-assistant:entities-atlas";
const SPRITES_PER_ROW = 16;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    image.src = url;
  });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Failed to read selected file."));
    reader.readAsDataURL(file);
  });
}

function shouldDrawLayer(layer, layerVisibility) {
  return Boolean(layer && layerVisibility[layer.kind]);
}

export class EntityOverlay {
  constructor({ mapCanvas, entityCanvas, mapViewer }) {
    this.mapCanvas = mapCanvas;
    this.entityCanvas = entityCanvas;
    this.mapViewer = mapViewer;

    this.ctx = entityCanvas.getContext("2d", { alpha: true });
    this.ctx.imageSmoothingEnabled = false;

    this.mapLoaded = false;
    this.physicsLayers = null;

    this.viewMode = "design";
    this.mixedOpacity = 0.55;
    this.showNumbers = false;
    this.layerVisibility = {
      game: true,
      front: true,
      tele: true,
      speedup: true,
      switch: true,
      tune: true
    };

    this.defaultAtlasUrl = new URL(
      `${import.meta.env.BASE_URL}entities.png`,
      window.location.href
    ).toString();

    this.atlasImage = null;
    this.atlasTileWidth = 64;
    this.atlasTileHeight = 64;

    this._raf = null;
    this._needsRender = true;
    this._lastViewBounds = null;
  }

  async initialize() {
    await this.#loadDefaultAtlas();
    await this.#restoreCustomAtlas();
    this.#applyViewMode();
    this.#loop();
  }

  setMapLoaded(loaded) {
    this.mapLoaded = loaded;
    this._needsRender = true;
  }

  setPhysicsLayers(physicsLayers) {
    this.physicsLayers = physicsLayers;
    this._needsRender = true;
  }

  setViewMode(mode) {
    this.viewMode = ["design", "entities", "mixed"].includes(mode) ? mode : "design";
    this.#applyViewMode();
    this._needsRender = true;
  }

  setMixedOpacity(value) {
    this.mixedOpacity = clamp(value, 0, 1);
    this.#applyViewMode();
    this._needsRender = true;
  }

  setShowNumbers(showNumbers) {
    this.showNumbers = Boolean(showNumbers);
    this._needsRender = true;
  }

  setLayerVisibility(layerVisibility) {
    this.layerVisibility = {
      ...this.layerVisibility,
      ...layerVisibility
    };
    this._needsRender = true;
  }

  async loadCustomAtlasFile(file) {
    const dataUrl = await fileToDataUrl(file);
    await this.#setAtlasFromUrl(dataUrl);
    try {
      localStorage.setItem(CUSTOM_ENTITIES_STORAGE_KEY, dataUrl);
    } catch (error) {
      console.warn("Could not cache custom entities atlas.", error);
    }
  }

  async resetAtlasToDefault() {
    localStorage.removeItem(CUSTOM_ENTITIES_STORAGE_KEY);
    await this.#loadDefaultAtlas();
    this._needsRender = true;
  }

  getCompositeCanvas() {
    const out = document.createElement("canvas");
    out.width = this.mapCanvas.width;
    out.height = this.mapCanvas.height;
    const ctx = out.getContext("2d", { alpha: true });

    if (this.viewMode !== "entities") {
      ctx.drawImage(this.mapCanvas, 0, 0);
    }

    if (this.viewMode !== "design") {
      ctx.globalAlpha = this.viewMode === "mixed" ? this.mixedOpacity : 1;
      ctx.drawImage(this.entityCanvas, 0, 0);
      ctx.globalAlpha = 1;
    }

    return out;
  }

  #loop() {
    const frame = () => {
      this.#renderIfNeeded();
      this._raf = window.requestAnimationFrame(frame);
    };
    this._raf = window.requestAnimationFrame(frame);
  }

  async #loadDefaultAtlas() {
    await this.#setAtlasFromUrl(this.defaultAtlasUrl);
  }

  async #restoreCustomAtlas() {
    try {
      const saved = localStorage.getItem(CUSTOM_ENTITIES_STORAGE_KEY);
      if (!saved) {
        return;
      }
      await this.#setAtlasFromUrl(saved);
    } catch (error) {
      console.warn("Could not restore custom entities atlas.", error);
    }
  }

  async #setAtlasFromUrl(url) {
    const image = await loadImage(url);
    this.atlasImage = image;
    this.atlasTileWidth = Math.max(1, Math.floor(image.width / SPRITES_PER_ROW));
    this.atlasTileHeight = Math.max(1, Math.floor(image.height / SPRITES_PER_ROW));
    this._needsRender = true;
  }

  #applyViewMode() {
    if (this.viewMode === "design") {
      this.mapCanvas.style.opacity = "1";
      this.entityCanvas.style.opacity = "0";
      this.entityCanvas.style.visibility = "hidden";
      return;
    }

    this.entityCanvas.style.visibility = "visible";
    if (this.viewMode === "entities") {
      this.mapCanvas.style.opacity = "0";
      this.entityCanvas.style.opacity = "1";
      return;
    }

    this.mapCanvas.style.opacity = "1";
    this.entityCanvas.style.opacity = String(this.mixedOpacity);
  }

  #syncCanvasSize() {
    if (
      this.entityCanvas.width !== this.mapCanvas.width ||
      this.entityCanvas.height !== this.mapCanvas.height
    ) {
      this.entityCanvas.width = this.mapCanvas.width;
      this.entityCanvas.height = this.mapCanvas.height;
      this.ctx.imageSmoothingEnabled = false;
      this._needsRender = true;
      return true;
    }
    return false;
  }

  #renderIfNeeded() {
    const resized = this.#syncCanvasSize();
    const viewBounds = this.#computeViewBounds();

    const mapMoved =
      !this._lastViewBounds ||
      !viewBounds ||
      Math.abs((viewBounds?.left ?? 0) - (this._lastViewBounds?.left ?? 0)) > 0.0001 ||
      Math.abs((viewBounds?.top ?? 0) - (this._lastViewBounds?.top ?? 0)) > 0.0001 ||
      Math.abs((viewBounds?.right ?? 0) - (this._lastViewBounds?.right ?? 0)) > 0.0001 ||
      Math.abs((viewBounds?.bottom ?? 0) - (this._lastViewBounds?.bottom ?? 0)) > 0.0001;

    if (!this._needsRender && !resized && !mapMoved) {
      return;
    }

    this._lastViewBounds = viewBounds;
    this._needsRender = false;

    this.ctx.clearRect(0, 0, this.entityCanvas.width, this.entityCanvas.height);
    if (this.viewMode === "design") {
      return;
    }

    if (!this.mapLoaded || !this.atlasImage || !this.physicsLayers || !viewBounds) {
      return;
    }

    this.#renderLayers(viewBounds);
  }

  #computeViewBounds() {
    if (!this.mapLoaded) {
      return null;
    }

    const topLeft = this.mapViewer.mapPositionFromLogical(0, 0);
    const bottomRight = this.mapViewer.mapPositionFromLogical(1, 1);
    if (!topLeft || !bottomRight) {
      return null;
    }

    const left = Math.min(topLeft.x, bottomRight.x);
    const right = Math.max(topLeft.x, bottomRight.x);
    const top = Math.min(topLeft.y, bottomRight.y);
    const bottom = Math.max(topLeft.y, bottomRight.y);

    if (!Number.isFinite(left) || !Number.isFinite(right) || !Number.isFinite(top) || !Number.isFinite(bottom)) {
      return null;
    }

    return {
      left,
      right,
      top,
      bottom,
      width: Math.max(0.0001, right - left),
      height: Math.max(0.0001, bottom - top)
    };
  }

  #renderLayers(bounds) {
    const width = this.physicsLayers.width;
    const height = this.physicsLayers.height;
    if (!width || !height) {
      return;
    }

    const scaleX = this.entityCanvas.width / bounds.width;
    const scaleY = this.entityCanvas.height / bounds.height;

    const tileDrawWidth = Math.max(0.01, scaleX);
    const tileDrawHeight = Math.max(0.01, scaleY);

    const minX = clamp(Math.floor(bounds.left) - 1, 0, width - 1);
    const maxX = clamp(Math.ceil(bounds.right) + 1, 0, width - 1);
    const minY = clamp(Math.floor(bounds.top) - 1, 0, height - 1);
    const maxY = clamp(Math.ceil(bounds.bottom) + 1, 0, height - 1);

    const overlayNumbers = [];
    const drawOrder = ["game", "front", "tele", "speedup", "switch", "tune"];

    for (const layerKey of drawOrder) {
      const layer = this.physicsLayers.layers[layerKey];
      if (!shouldDrawLayer(layer, this.layerVisibility)) {
        continue;
      }

      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const tileIndex = y * width + x;
          const tileId = layer.ids?.[tileIndex] ?? 0;
          if (tileId <= 0) {
            continue;
          }

          this.#drawTile(tileId, x, y, bounds, tileDrawWidth, tileDrawHeight);

          if (this.showNumbers) {
            const number = layer.numbers?.[tileIndex] ?? 0;
            if (number > 0) {
              overlayNumbers.push({ x, y, number });
            }
          }
        }
      }
    }

    if (this.showNumbers && overlayNumbers.length > 0) {
      this.#drawNumbers(overlayNumbers, bounds, tileDrawWidth, tileDrawHeight);
    }
  }

  #drawTile(tileId, tileX, tileY, bounds, tileDrawWidth, tileDrawHeight) {
    const spriteIndex = tileId - 1;
    if (spriteIndex < 0) {
      return;
    }

    const spriteX = spriteIndex % SPRITES_PER_ROW;
    const spriteY = Math.floor(spriteIndex / SPRITES_PER_ROW);
    const sourceX = spriteX * this.atlasTileWidth;
    const sourceY = spriteY * this.atlasTileHeight;

    if (
      sourceX + this.atlasTileWidth > this.atlasImage.width ||
      sourceY + this.atlasTileHeight > this.atlasImage.height
    ) {
      return;
    }

    const drawX = (tileX - bounds.left) * (this.entityCanvas.width / bounds.width);
    const drawY = (tileY - bounds.top) * (this.entityCanvas.height / bounds.height);

    this.ctx.drawImage(
      this.atlasImage,
      sourceX,
      sourceY,
      this.atlasTileWidth,
      this.atlasTileHeight,
      drawX,
      drawY,
      tileDrawWidth,
      tileDrawHeight
    );
  }

  #drawNumbers(numbers, bounds, tileDrawWidth, tileDrawHeight) {
    const fontSize = clamp(Math.round(Math.min(tileDrawWidth, tileDrawHeight) * 0.44), 8, 18);
    this.ctx.save();
    this.ctx.font = `700 ${fontSize}px "IBM Plex Sans", sans-serif`;
    this.ctx.textAlign = "center";
    this.ctx.textBaseline = "middle";
    this.ctx.lineWidth = Math.max(2, Math.floor(fontSize * 0.25));
    this.ctx.strokeStyle = "rgba(13, 20, 32, 0.95)";
    this.ctx.fillStyle = "#f7faff";

    const scaleX = this.entityCanvas.width / bounds.width;
    const scaleY = this.entityCanvas.height / bounds.height;

    for (const item of numbers) {
      const centerX = (item.x - bounds.left + 0.5) * scaleX;
      const centerY = (item.y - bounds.top + 0.5) * scaleY;
      const text = String(item.number);
      this.ctx.strokeText(text, centerX, centerY);
      this.ctx.fillText(text, centerX, centerY);
    }

    this.ctx.restore();
  }
}
