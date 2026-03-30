const TRANSPARENT_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAoMBgN11m1wAAAAASUVORK5CYII=";

let rendererModulePromise = null;
let fetchProxyInstalled = false;

const transparentPngBytes = Uint8Array.from(atob(TRANSPARENT_PNG_BASE64), (ch) =>
  ch.charCodeAt(0)
);

function resolveRequestUrl(input) {
  if (typeof input === "string") {
    return new URL(input, window.location.href);
  }
  if (input instanceof URL) {
    return input;
  }
  if (input instanceof Request) {
    return new URL(input.url, window.location.href);
  }
  return null;
}

function toRemoteMapresUrl(pathname) {
  if (!/^\/mapres_0[67]\/.+/.test(pathname)) {
    return null;
  }
  return `https://mapview.patiga.eu${pathname}`;
}

function installMapresFetchProxy(getMode) {
  if (fetchProxyInstalled) {
    return;
  }
  fetchProxyInstalled = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input, init) => {
    const requestUrl = resolveRequestUrl(input);
    const mode = getMode();

    if (requestUrl && /^\/mapres_0[67]\//.test(requestUrl.pathname)) {
      if (mode === "embedded") {
        return new Response(transparentPngBytes, {
          status: 200,
          headers: {
            "Content-Type": "image/png",
            "Cache-Control": "no-store"
          }
        });
      }

      const base = new URL(import.meta.env.BASE_URL, window.location.href);
      const localPath = requestUrl.pathname.replace(/^\//, "");
      const localUrl = new URL(localPath, base);

      const localResponse = await originalFetch(localUrl, init);
      if (localResponse.ok) {
        return localResponse;
      }

      const remoteUrl = toRemoteMapresUrl(requestUrl.pathname);
      if (!remoteUrl) {
        return localResponse;
      }
      return originalFetch(remoteUrl, init);
    }

    return originalFetch(input, init);
  };
}

async function loadRendererModule() {
  if (!rendererModulePromise) {
    const localModuleUrl = new URL(
      `${import.meta.env.BASE_URL}pkg/map_inspect_web.js`,
      window.location.href
    ).toString();

    rendererModulePromise = (async () => {
      const mod = await import(/* @vite-ignore */ localModuleUrl);
      await mod.default();
      if (typeof mod.map_position_from_logical !== "function") {
        throw new Error("Renderer bundle missing exact coordinate API.");
      }
      return mod;
    })();
  }
  return rendererModulePromise;
}

function clampRect(rect, maxW, maxH) {
  const x = Math.max(0, Math.min(maxW, rect.x));
  const y = Math.max(0, Math.min(maxH, rect.y));
  const w = Math.max(1, Math.min(maxW - x, rect.w));
  const h = Math.max(1, Math.min(maxH - y, rect.h));
  return { x, y, w, h };
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function isWasmControlFlowError(error) {
  const message =
    (error && typeof error === "object" && "message" in error && error.message) || "";
  return (
    typeof message === "string" &&
    message.includes("Using exceptions for control flow")
  );
}

export class MapViewer {
  constructor(canvas, hintElement, getMapresMode) {
    this.canvas = canvas;
    this.hintElement = hintElement;
    this.getMapresMode = getMapresMode;
    this.rendererApp = null;
    this.rendererModule = null;
    this.loaded = false;

    installMapresFetchProxy(() => this.getMapresMode());
  }

  setMapGeometry(_mapGeometry) {
    // Kept for compatibility with caller. Exact coordinates now come from wasm renderer state.
  }

  async loadMap(arrayBuffer) {
    const mod = await loadRendererModule();
    const { RenderInit } = mod;

    this.hintElement.textContent = "Loading map renderer...";
    const renderInit = await new RenderInit(this.canvas, null);
    this.rendererApp = await renderInit.prepare_map(new Uint8Array(arrayBuffer));
    this.rendererModule = mod;

    try {
      this.rendererApp.run();
    } catch (error) {
      if (!isWasmControlFlowError(error)) {
        throw error;
      }
    }

    this.loaded = true;
    this.hintElement.textContent =
      "Drag to select area. Mouse wheel or trackpad to zoom. Left drag to pan.";
  }

  isLoaded() {
    return this.loaded;
  }

  captureFromSelection(selection) {
    if (!this.loaded) {
      throw new Error("Load a map before capturing screenshots.");
    }

    let imageCanvas = null;
    if (selection.kind === "rect") {
      imageCanvas = this.#captureRect(selection.rect);
    } else if (selection.kind === "lasso") {
      imageCanvas = this.#captureLasso(selection.points);
    } else {
      throw new Error("Unknown selection type.");
    }

    const centerCssPoint = this.#selectionCenterCssPoint(selection);
    const mapCoordinates = this.#mapCoordinatesFromCssPoint(centerCssPoint);
    if (!mapCoordinates) {
      throw new Error("Exact map coordinates unavailable from renderer.");
    }

    return {
      imageCanvas,
      mapCoordinates
    };
  }

  #captureRect(cssRect) {
    const pxRect = this.#cssRectToPixelRect(cssRect);
    const bounded = clampRect(pxRect, this.canvas.width, this.canvas.height);
    const out = document.createElement("canvas");
    out.width = bounded.w;
    out.height = bounded.h;
    const ctx = out.getContext("2d", { alpha: true });
    ctx.drawImage(
      this.canvas,
      bounded.x,
      bounded.y,
      bounded.w,
      bounded.h,
      0,
      0,
      bounded.w,
      bounded.h
    );
    return out;
  }

  #captureLasso(cssPoints) {
    if (!cssPoints.length) {
      throw new Error("Lasso selection is empty.");
    }

    const pxPoints = cssPoints.map((p) => this.#cssToPixelPoint(p));
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const p of pxPoints) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }

    minX = Math.floor(Math.max(0, minX));
    minY = Math.floor(Math.max(0, minY));
    maxX = Math.ceil(Math.min(this.canvas.width, maxX));
    maxY = Math.ceil(Math.min(this.canvas.height, maxY));

    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);

    const out = document.createElement("canvas");
    out.width = width;
    out.height = height;
    const ctx = out.getContext("2d", { alpha: true });

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pxPoints[0].x - minX, pxPoints[0].y - minY);
    for (let i = 1; i < pxPoints.length; i += 1) {
      ctx.lineTo(pxPoints[i].x - minX, pxPoints[i].y - minY);
    }
    ctx.closePath();
    ctx.clip();

    ctx.drawImage(this.canvas, -minX, -minY);
    ctx.restore();

    return out;
  }

  #selectionCenterCssPoint(selection) {
    if (selection.kind === "rect") {
      return {
        x: selection.rect.x + selection.rect.w / 2,
        y: selection.rect.y + selection.rect.h / 2
      };
    }

    const points = selection.points;
    if (!points.length) {
      return {
        x: this.canvas.clientWidth / 2,
        y: this.canvas.clientHeight / 2
      };
    }

    let sumX = 0;
    let sumY = 0;
    for (const point of points) {
      sumX += point.x;
      sumY += point.y;
    }
    return {
      x: sumX / points.length,
      y: sumY / points.length
    };
  }

  #mapCoordinatesFromCssPoint(point) {
    if (
      !this.rendererModule ||
      typeof this.rendererModule.map_position_from_logical !== "function"
    ) {
      return null;
    }

    const logicalX = clamp01(point.x / Math.max(1, this.canvas.clientWidth));
    const logicalY = clamp01(point.y / Math.max(1, this.canvas.clientHeight));
    const coords = this.rendererModule.map_position_from_logical(logicalX, logicalY);
    const x = Number(coords?.[0]);
    const y = Number(coords?.[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return null;
    }
    return { x, y };
  }

  #cssRectToPixelRect(cssRect) {
    const scaleX = this.canvas.width / this.canvas.clientWidth;
    const scaleY = this.canvas.height / this.canvas.clientHeight;

    return {
      x: Math.round(cssRect.x * scaleX),
      y: Math.round(cssRect.y * scaleY),
      w: Math.round(cssRect.w * scaleX),
      h: Math.round(cssRect.h * scaleY)
    };
  }

  #cssToPixelPoint(point) {
    const scaleX = this.canvas.width / this.canvas.clientWidth;
    const scaleY = this.canvas.height / this.canvas.clientHeight;
    return {
      x: point.x * scaleX,
      y: point.y * scaleY
    };
  }
}

export function canvasToPngDataUrl(canvas) {
  return canvas.toDataURL("image/png");
}
