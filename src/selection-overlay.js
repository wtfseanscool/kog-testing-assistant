function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function normalizeRect(start, end) {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const w = Math.abs(end.x - start.x);
  const h = Math.abs(end.y - start.y);
  return { x, y, w, h };
}

export class SelectionOverlay {
  constructor(stage, canvas) {
    this.stage = stage;
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.enabled = false;
    this.tool = "rect";

    this.dragging = false;
    this.pointerId = null;
    this.startPoint = null;
    this.currentPoint = null;
    this.lassoPoints = [];
    this.selection = null;

    this.onChange = () => {};

    this.#attachListeners();
    this.resize();
  }

  #attachListeners() {
    this.stage.addEventListener(
      "pointerdown",
      (event) => {
        const isShiftSelection = event.shiftKey;
        const isRightClickSelection = event.button === 2;
        if (!this.enabled || (!isShiftSelection && !isRightClickSelection)) {
          return;
        }

        this.dragging = true;
        this.pointerId = event.pointerId;
        this.startPoint = this.#eventToCanvasPoint(event);
        this.currentPoint = this.startPoint;
        this.lassoPoints = [this.startPoint];
        this.selection = null;

        this.#draw();
        this.stage.setPointerCapture(event.pointerId);
        event.preventDefault();
        event.stopPropagation();
      },
      true
    );

    this.stage.addEventListener(
      "contextmenu",
      (event) => {
        if (!this.enabled) {
          return;
        }
        event.preventDefault();
      },
      true
    );

    this.stage.addEventListener(
      "pointermove",
      (event) => {
        if (!this.dragging || event.pointerId !== this.pointerId) {
          return;
        }

        const point = this.#eventToCanvasPoint(event);
        this.currentPoint = point;
        if (this.tool === "lasso") {
          const last = this.lassoPoints[this.lassoPoints.length - 1];
          if (!last || distance(last, point) > 1.8) {
            this.lassoPoints.push(point);
          }
        }

        this.#draw();
        event.preventDefault();
        event.stopPropagation();
      },
      true
    );

    this.stage.addEventListener(
      "pointerup",
      (event) => {
        if (!this.dragging || event.pointerId !== this.pointerId) {
          return;
        }

        this.dragging = false;
        this.pointerId = null;
        this.#finalizeSelection();
        this.#draw();
        this.onChange(this.selection);
        event.preventDefault();
        event.stopPropagation();
      },
      true
    );

    this.stage.addEventListener(
      "pointercancel",
      (event) => {
        if (!this.dragging || event.pointerId !== this.pointerId) {
          return;
        }
        this.dragging = false;
        this.pointerId = null;
        this.#draw();
        this.onChange(this.selection);
        event.preventDefault();
        event.stopPropagation();
      },
      true
    );

    window.addEventListener("resize", () => this.resize());
  }

  #eventToCanvasPoint(event) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }

  #finalizeSelection() {
    if (!this.startPoint || !this.currentPoint) {
      this.selection = null;
      return;
    }

    if (this.tool === "rect") {
      const rect = normalizeRect(this.startPoint, this.currentPoint);
      if (rect.w < 6 || rect.h < 6) {
        this.selection = null;
        return;
      }

      this.selection = {
        kind: "rect",
        rect
      };
      return;
    }

    if (this.lassoPoints.length < 3) {
      this.selection = null;
      return;
    }

    this.selection = {
      kind: "lasso",
      points: this.lassoPoints.map((p) => ({ ...p }))
    };
  }

  #drawDimBackground() {
    this.ctx.save();
    this.ctx.fillStyle = "rgba(4, 17, 15, 0.24)";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.restore();
  }

  #draw() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const activeSelection = this.dragging
      ? this.#currentDragSelection()
      : this.selection;

    if (!activeSelection) {
      return;
    }

    this.#drawDimBackground();

    this.ctx.save();
    this.ctx.strokeStyle = "#26d4c5";
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash([8, 6]);
    this.ctx.shadowBlur = 12;
    this.ctx.shadowColor = "rgba(30, 183, 168, 0.55)";

    if (activeSelection.kind === "rect") {
      const { x, y, w, h } = activeSelection.rect;
      this.ctx.clearRect(x, y, w, h);
      this.ctx.strokeRect(x, y, w, h);
    } else {
      const points = activeSelection.points;
      this.ctx.beginPath();
      this.ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i += 1) {
        this.ctx.lineTo(points[i].x, points[i].y);
      }
      this.ctx.closePath();
      this.ctx.save();
      this.ctx.clip();
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx.restore();
      this.ctx.stroke();
    }

    this.ctx.restore();
  }

  #currentDragSelection() {
    if (!this.startPoint || !this.currentPoint) {
      return null;
    }

    if (this.tool === "rect") {
      return {
        kind: "rect",
        rect: normalizeRect(this.startPoint, this.currentPoint)
      };
    }

    return {
      kind: "lasso",
      points: this.lassoPoints
    };
  }

  setTool(tool) {
    this.tool = tool;
    this.#draw();
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) {
      this.clear();
    }
  }

  setOnChange(onChange) {
    this.onChange = onChange;
  }

  clear() {
    this.dragging = false;
    this.pointerId = null;
    this.startPoint = null;
    this.currentPoint = null;
    this.lassoPoints = [];
    this.selection = null;
    this.#draw();
  }

  getSelection() {
    return this.selection;
  }

  resize() {
    const rect = this.stage.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.floor(rect.width));
    this.canvas.height = Math.max(1, Math.floor(rect.height));
    this.#draw();
  }
}
