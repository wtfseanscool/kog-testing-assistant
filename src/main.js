import { parseMapMetadata } from "./map-metadata.js";
import { MapViewer, canvasToPngDataUrl } from "./map-viewer.js";
import { EntityOverlay } from "./entity-overlay.js";
import { SelectionOverlay } from "./selection-overlay.js";
import { ScreenshotManager } from "./screenshot-manager.js";
import { buildReportCanvas, downloadCanvasPng } from "./export-report.js";

const mapUploadInput = document.querySelector("#map-upload");
const loadProjectInput = document.querySelector("#load-project");
const mapresModeSelect = document.querySelector("#mapres-mode");
const autoCaptureToggle = document.querySelector("#auto-capture-toggle");
const captureBtn = document.querySelector("#capture-btn");
const clearSelectionBtn = document.querySelector("#clear-selection");
const rectToolBtn = document.querySelector("#tool-rect");
const lassoToolBtn = document.querySelector("#tool-lasso");
const saveProjectBtn = document.querySelector("#save-project-btn");
const exportReportBtn = document.querySelector("#export-report-btn");
const mapNameBadge = document.querySelector("#map-name-badge");
const clearRecoveryBtn = document.querySelector("#clear-recovery-btn");
const mapCanvas = document.querySelector("#map-canvas");
const entityCanvas = document.querySelector("#entity-canvas");
const viewerStage = document.querySelector("#viewer-stage");
const selectionCanvas = document.querySelector("#selection-canvas");
const viewerHint = document.querySelector("#viewer-hint");
const shotsList = document.querySelector("#shots-list");
const shotTemplate = document.querySelector("#shot-card-template");
const mapSwitchModal = document.querySelector("#map-switch-modal");
const mapSwitchClearBtn = document.querySelector("#map-switch-clear");
const mapSwitchKeepBtn = document.querySelector("#map-switch-keep");
const mapSwitchCancelBtn = document.querySelector("#map-switch-cancel");
const viewModeSelect = document.querySelector("#view-mode");
const mixedOpacityInput = document.querySelector("#mixed-opacity");
const showEntityNumbersToggle = document.querySelector("#show-entity-numbers");
const layerGameToggle = document.querySelector("#layer-game");
const layerFrontToggle = document.querySelector("#layer-front");
const layerTeleToggle = document.querySelector("#layer-tele");
const layerSpeedupToggle = document.querySelector("#layer-speedup");
const layerSwitchToggle = document.querySelector("#layer-switch");
const layerTuneToggle = document.querySelector("#layer-tune");
const entitiesUploadInput = document.querySelector("#entities-upload");
const entitiesResetBtn = document.querySelector("#entities-reset");
const settingsMenu = document.querySelector(".settings-menu");

const AUTOSAVE_KEY = "kog-testing-assistant:autosave:v1";
const SWITCH_DB_NAME = "kog-testing-assistant-switch";
const SWITCH_DB_STORE = "kv";
const SWITCH_PAYLOAD_KEY = "pending-switch-payload";
const SWITCH_PENDING_FLAG = "kog-switch-pending";
const state = {
  mapName: "Untitled Map",
  sourceFileName: "",
  mapresMode: mapresModeSelect.value,
  autoCaptureEnabled: Boolean(autoCaptureToggle?.checked),
  viewMode: viewModeSelect?.value ?? "design",
  mixedOpacity: Number(mixedOpacityInput?.value ?? 55) / 100,
  showEntityNumbers: Boolean(showEntityNumbersToggle?.checked),
  entityLayerVisibility: {
    game: Boolean(layerGameToggle?.checked),
    front: Boolean(layerFrontToggle?.checked),
    tele: Boolean(layerTeleToggle?.checked),
    speedup: Boolean(layerSpeedupToggle?.checked),
    switch: Boolean(layerSwitchToggle?.checked),
    tune: Boolean(layerTuneToggle?.checked)
  },
  mapLoaded: false
};

let autosaveTimer = null;
let captureInProgress = false;
let mapLoadInProgress = false;
let appInitializationPromise = null;
let suppressUnloadPrompt = false;

const mapViewer = new MapViewer(mapCanvas, viewerHint, () => state.mapresMode);
const entityOverlay = new EntityOverlay({ mapCanvas, entityCanvas, mapViewer });
const selectionOverlay = new SelectionOverlay(viewerStage, selectionCanvas);
const screenshotManager = new ScreenshotManager(shotsList, shotTemplate);

selectionOverlay.setEnabled(false);
selectionOverlay.setOnChange((selection) => {
  captureBtn.disabled = !selection;

  if (selection && state.autoCaptureEnabled) {
    void onCaptureSelection();
  }
});

function setCaptureTool(tool) {
  selectionOverlay.setTool(tool);
  if (tool === "rect") {
    rectToolBtn.classList.add("is-active");
    lassoToolBtn.classList.remove("is-active");
  } else {
    lassoToolBtn.classList.add("is-active");
    rectToolBtn.classList.remove("is-active");
  }
}

function safeName(name) {
  return (name || "kog-testing-assistant")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function fileTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
}

function saveBlobAsFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function showToast(message, type = "success", duration = 3000) {
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("toast-hiding");
    setTimeout(() => {
      document.body.removeChild(toast);
    }, 300);
  }, duration);
}

function canvasToBlob(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png");
  });
}

async function copyCanvasToClipboard(canvas) {
  if (!navigator.clipboard || typeof window.ClipboardItem === "undefined") {
    return false;
  }

  try {
    const blob = await canvasToBlob(canvas);
    if (!blob) {
      return false;
    }

    await navigator.clipboard.write([
      new window.ClipboardItem({
        "image/png": blob
      })
    ]);
    return true;
  } catch (error) {
    console.warn("Clipboard copy failed.", error);
    return false;
  }
}

function buildEntitySettings() {
  return {
    viewMode: state.viewMode,
    mixedOpacity: state.mixedOpacity,
    showNumbers: state.showEntityNumbers,
    layerVisibility: { ...state.entityLayerVisibility }
  };
}

function applyEntitySettingsToOverlay() {
  entityOverlay.setViewMode(state.viewMode);
  entityOverlay.setMixedOpacity(state.mixedOpacity);
  entityOverlay.setShowNumbers(state.showEntityNumbers);
  entityOverlay.setLayerVisibility(state.entityLayerVisibility);
}

function syncEntitySettingsInputs() {
  if (viewModeSelect) {
    viewModeSelect.value = state.viewMode;
  }
  if (mixedOpacityInput) {
    mixedOpacityInput.value = String(Math.round(state.mixedOpacity * 100));
  }
  if (showEntityNumbersToggle) {
    showEntityNumbersToggle.checked = state.showEntityNumbers;
  }
  if (layerGameToggle) {
    layerGameToggle.checked = state.entityLayerVisibility.game;
  }
  if (layerFrontToggle) {
    layerFrontToggle.checked = state.entityLayerVisibility.front;
  }
  if (layerTeleToggle) {
    layerTeleToggle.checked = state.entityLayerVisibility.tele;
  }
  if (layerSpeedupToggle) {
    layerSpeedupToggle.checked = state.entityLayerVisibility.speedup;
  }
  if (layerSwitchToggle) {
    layerSwitchToggle.checked = state.entityLayerVisibility.switch;
  }
  if (layerTuneToggle) {
    layerTuneToggle.checked = state.entityLayerVisibility.tune;
  }
}

function applyEntitySettings(settings) {
  const defaultVisibility = {
    game: true,
    front: true,
    tele: true,
    speedup: true,
    switch: true,
    tune: true
  };

  state.viewMode = ["design", "entities", "mixed"].includes(settings?.viewMode)
    ? settings.viewMode
    : "design";

  const mixedOpacity = Number(settings?.mixedOpacity);
  state.mixedOpacity = Number.isFinite(mixedOpacity)
    ? Math.max(0, Math.min(1, mixedOpacity))
    : 0.55;

  state.showEntityNumbers = Boolean(settings?.showNumbers);
  state.entityLayerVisibility = {
    ...defaultVisibility,
    ...(settings?.layerVisibility ?? {})
  };

  syncEntitySettingsInputs();
  applyEntitySettingsToOverlay();
  updateMixedOpacityControlState();
}

function updateMixedOpacityControlState() {
  if (!mixedOpacityInput) {
    return;
  }

  const enabled = state.viewMode === "mixed";
  mixedOpacityInput.disabled = !enabled;
  mixedOpacityInput.style.opacity = enabled ? "1" : "0.45";
}

function buildProjectData() {
  return {
    version: 1,
    mapName: state.mapName,
    sourceFileName: state.sourceFileName,
    mapresMode: state.mapresMode,
    autoCaptureEnabled: state.autoCaptureEnabled,
    entityView: buildEntitySettings(),
    screenshots: screenshotManager.getSerializableProject(),
    savedAt: new Date().toISOString()
  };
}

function queueAutosave() {
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
  }

  autosaveTimer = setTimeout(() => {
    autosaveTimer = null;
    try {
      localStorage.setItem(
        AUTOSAVE_KEY,
        JSON.stringify({
          ...buildProjectData(),
          autosavedAt: new Date().toISOString()
        })
      );
    } catch (error) {
      console.warn("Autosave failed.", error);
    }
  }, 220);
}

function updateClearRecoveryButtonVisibility() {
  if (!clearRecoveryBtn) {
    return;
  }

  clearRecoveryBtn.hidden = !screenshotManager.hasScreenshots();
}

function openSwitchDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SWITCH_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SWITCH_DB_STORE)) {
        db.createObjectStore(SWITCH_DB_STORE);
      }
    };
    request.onerror = () => reject(request.error ?? new Error("Failed to open switch database."));
    request.onsuccess = () => resolve(request.result);
  });
}

async function switchDbSet(key, value) {
  const db = await openSwitchDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(SWITCH_DB_STORE, "readwrite");
    tx.objectStore(SWITCH_DB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to write switch payload."));
  });
  db.close();
}

async function switchDbGet(key) {
  const db = await openSwitchDb();
  const value = await new Promise((resolve, reject) => {
    const tx = db.transaction(SWITCH_DB_STORE, "readonly");
    const request = tx.objectStore(SWITCH_DB_STORE).get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error ?? new Error("Failed to read switch payload."));
  });
  db.close();
  return value;
}

async function switchDbDelete(key) {
  const db = await openSwitchDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(SWITCH_DB_STORE, "readwrite");
    tx.objectStore(SWITCH_DB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to clear switch payload."));
  });
  db.close();
}

function markPendingSwitch() {
  sessionStorage.setItem(SWITCH_PENDING_FLAG, "1");
}

function consumePendingSwitchFlag() {
  const flagged = sessionStorage.getItem(SWITCH_PENDING_FLAG) === "1";
  sessionStorage.removeItem(SWITCH_PENDING_FLAG);
  return flagged;
}

async function savePendingSwitchPayload(payload) {
  await switchDbSet(SWITCH_PAYLOAD_KEY, payload);
  markPendingSwitch();
}

async function consumePendingSwitchPayload() {
  const shouldConsume = consumePendingSwitchFlag();
  if (!shouldConsume) {
    return null;
  }

  try {
    const payload = await switchDbGet(SWITCH_PAYLOAD_KEY);
    await switchDbDelete(SWITCH_PAYLOAD_KEY);
    return payload;
  } catch (error) {
    console.warn("Could not consume pending switch payload.", error);
    return null;
  }
}

async function askMapSwitchMode() {
  if (!state.mapLoaded || !screenshotManager.hasScreenshots()) {
    return "continue";
  }

  if (!mapSwitchModal || !mapSwitchClearBtn || !mapSwitchKeepBtn || !mapSwitchCancelBtn) {
    return "clear";
  }

  return new Promise((resolve) => {
    const previousActiveElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const cleanup = () => {
      mapSwitchModal.hidden = true;
      mapSwitchModal.removeEventListener("click", onBackdropClick);
      mapSwitchClearBtn.removeEventListener("click", onClear);
      mapSwitchKeepBtn.removeEventListener("click", onKeep);
      mapSwitchCancelBtn.removeEventListener("click", onCancel);
      document.removeEventListener("keydown", onKeyDown, true);
      previousActiveElement?.focus();
    };

    const finish = (choice) => {
      cleanup();
      resolve(choice);
    };

    const onClear = () => finish("clear");
    const onKeep = () => finish("keep");
    const onCancel = () => finish("cancel");
    const onBackdropClick = (event) => {
      if (event.target === mapSwitchModal) {
        finish("cancel");
      }
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish("cancel");
      }
    };

    mapSwitchModal.hidden = false;
    mapSwitchModal.addEventListener("click", onBackdropClick);
    mapSwitchClearBtn.addEventListener("click", onClear);
    mapSwitchKeepBtn.addEventListener("click", onKeep);
    mapSwitchCancelBtn.addEventListener("click", onCancel);
    document.addEventListener("keydown", onKeyDown, true);

    mapSwitchClearBtn.focus();
  });
}

async function restoreAutosaveDraft() {
  const raw = localStorage.getItem(AUTOSAVE_KEY);
  if (!raw) {
    return;
  }

  try {
    const project = JSON.parse(raw);
    if (!project || project.version !== 1 || !Array.isArray(project.screenshots)) {
      return;
    }

    state.mapName = project.mapName || "Untitled Map";
    state.sourceFileName = project.sourceFileName || "";

    if (project.mapresMode === "embedded" || project.mapresMode === "bundled") {
      state.mapresMode = project.mapresMode;
      mapresModeSelect.value = project.mapresMode;
    }

    state.autoCaptureEnabled = Boolean(project.autoCaptureEnabled);
    if (autoCaptureToggle) {
      autoCaptureToggle.checked = state.autoCaptureEnabled;
    }

    applyEntitySettings(project.entityView);

    if (project.screenshots.length > 0) {
      await screenshotManager.loadSerializableProject(project.screenshots);
      mapNameBadge.textContent = `Recovered: ${state.mapName}`;
      viewerHint.textContent =
        "Draft restored from browser cache. Upload a map to capture additional screenshots.";
    }
    updateClearRecoveryButtonVisibility();
  } catch (error) {
    console.warn("Could not restore autosave draft.", error);
  }
}

async function loadMapFromArrayBuffer(arrayBuffer, fileName) {
  if (mapLoadInProgress) {
    throw new Error("A map is already loading. Please wait a moment and try again.");
  }

  mapLoadInProgress = true;
  mapUploadInput.disabled = true;

  try {
    const fallbackMapName = fileName.replace(/\.map$/i, "");
    let mapGeometry = {
      startPosition: { x: 0, y: 0 }
    };
    let physicsLayers = null;

    state.mapName = fallbackMapName;
    state.sourceFileName = fileName;
    entityOverlay.setMapLoaded(false);

    try {
      const metadata = parseMapMetadata(arrayBuffer, fileName);
      state.mapName = metadata.mapName || fallbackMapName;
      mapGeometry = metadata.mapGeometry ?? mapGeometry;
      physicsLayers = metadata.physicsLayers ?? metadata.mapGeometry?.physicsLayers ?? null;
    } catch (metadataError) {
      console.warn("Metadata parse failed, continuing with filename.", metadataError);
    }

    mapNameBadge.textContent = `Map: ${state.mapName}`;
    mapViewer.setMapGeometry(mapGeometry);
    entityOverlay.setPhysicsLayers(physicsLayers);

    await mapViewer.loadMap(arrayBuffer);
    state.mapLoaded = true;
    entityOverlay.setMapLoaded(true);
    selectionOverlay.setEnabled(true);
    selectionOverlay.clear();
    captureBtn.disabled = true;

    viewerHint.textContent =
      "Hold Shift or right-drag to select. Plain left-drag pans the map. Mouse wheel zooms.";
    updateClearRecoveryButtonVisibility();
    queueAutosave();
  } finally {
    mapLoadInProgress = false;
    mapUploadInput.disabled = false;
  }
}

async function switchMapByReload(file, switchMode) {
  try {
    viewerHint.textContent = "Switching maps...";
    mapUploadInput.disabled = true;

    const payload = {
      fileName: file.name,
      arrayBuffer: await file.arrayBuffer(),
      mapresMode: state.mapresMode,
      autoCaptureEnabled: state.autoCaptureEnabled,
      entityView: buildEntitySettings(),
      keepScreenshots: switchMode === "keep",
      screenshots: switchMode === "keep" ? screenshotManager.getSerializableProject() : []
    };

    await savePendingSwitchPayload(payload);

    suppressUnloadPrompt = true;
    window.location.reload();
  } catch (error) {
    console.error(error);
    alert(`Could not switch maps automatically: ${error.message}`);
    viewerHint.textContent = "Map switch failed. Try loading the map again.";
    mapUploadInput.disabled = false;
  }
}

async function onMapUpload() {
  if (appInitializationPromise) {
    await appInitializationPromise;
  }

  if (mapLoadInProgress) {
    return;
  }

  const file = mapUploadInput.files?.[0];
  if (!file) {
    return;
  }

  const switchMode = await askMapSwitchMode();
  if (switchMode === "cancel") {
    mapUploadInput.value = "";
    return;
  }

  if (state.mapLoaded) {
    await switchMapByReload(file, switchMode);
    mapUploadInput.value = "";
    return;
  }

  selectionOverlay.clear();
  captureBtn.disabled = true;

  try {
    viewerHint.textContent = "Reading map file...";
    const arrayBuffer = await file.arrayBuffer();
    await loadMapFromArrayBuffer(arrayBuffer, file.name);
  } catch (error) {
    console.error(error);
    alert(`Failed to load map: ${error.message}`);
    viewerHint.textContent = `Map load failed. ${error.message}`;
  } finally {
    mapUploadInput.value = "";
  }
}

async function onCaptureSelection() {
  if (captureInProgress) {
    return;
  }

  const selection = selectionOverlay.getSelection();
  if (!selection) {
    return;
  }

  captureInProgress = true;
  try {
    const captureSource =
      state.viewMode === "design" ? mapCanvas : entityOverlay.getCompositeCanvas();
    const capture = mapViewer.captureFromSelection(selection, captureSource);
    const dataUrl = canvasToPngDataUrl(capture.imageCanvas);
    await screenshotManager.addFromDataUrl(
      dataUrl,
      screenshotManager.getNextTitle(),
      null,
      capture.mapCoordinates
    );
    selectionOverlay.clear();
    captureBtn.disabled = true;
  } catch (error) {
    console.error(error);
    alert(`Capture failed: ${error.message}`);
  } finally {
    captureInProgress = false;
  }
}

function onSaveProject() {
  const project = buildProjectData();

  const blob = new Blob([JSON.stringify(project, null, 2)], {
    type: "application/json"
  });
  saveBlobAsFile(blob, `${safeName(state.mapName)}-kog-testing-assistant-project.json`);
}

async function onLoadProject() {
  const file = loadProjectInput.files?.[0];
  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    const project = JSON.parse(text);

    if (!project || project.version !== 1 || !Array.isArray(project.screenshots)) {
      throw new Error("Invalid project file format.");
    }

    state.mapName = project.mapName || "Untitled Map";
    state.sourceFileName = project.sourceFileName || "";
    if (project.mapresMode === "embedded" || project.mapresMode === "bundled") {
      state.mapresMode = project.mapresMode;
      mapresModeSelect.value = project.mapresMode;
    }

    state.autoCaptureEnabled = Boolean(project.autoCaptureEnabled);
    if (autoCaptureToggle) {
      autoCaptureToggle.checked = state.autoCaptureEnabled;
    }

    applyEntitySettings(project.entityView);

    mapNameBadge.textContent = `Project: ${state.mapName}`;
    await screenshotManager.loadSerializableProject(project.screenshots);
    updateClearRecoveryButtonVisibility();
    queueAutosave();
    alert("Project loaded. You can continue editing and export immediately.");
  } catch (error) {
    console.error(error);
    alert(`Could not load project: ${error.message}`);
  } finally {
    loadProjectInput.value = "";
  }
}

async function onExportReport() {
  if (!screenshotManager.hasScreenshots()) {
    alert("Add at least one screenshot before exporting.");
    return;
  }

  const exportData = screenshotManager.getExportData();
  const reportCanvas = buildReportCanvas(state.mapName, exportData);
  const fileName = `kog-testing-assistant-${safeName(state.mapName)}-${fileTimestamp()}.png`;
  downloadCanvasPng(
    reportCanvas,
    fileName
  );

  const copied = await copyCanvasToClipboard(reportCanvas);
  if (copied) {
    showToast("✓ Exported and copied to clipboard");
  } else {
    showToast("✓ Exported successfully");
  }
}

mapUploadInput.addEventListener("change", onMapUpload);
loadProjectInput.addEventListener("change", onLoadProject);
captureBtn.addEventListener("click", onCaptureSelection);
clearSelectionBtn.addEventListener("click", () => {
  selectionOverlay.clear();
  captureBtn.disabled = true;
});
saveProjectBtn.addEventListener("click", onSaveProject);
exportReportBtn.addEventListener("click", onExportReport);

screenshotManager.setOnChange(() => {
  updateClearRecoveryButtonVisibility();
  queueAutosave();
});

if (settingsMenu) {
  document.addEventListener("click", (event) => {
    if (!settingsMenu.open) {
      return;
    }

    if (event.target instanceof Node && settingsMenu.contains(event.target)) {
      return;
    }

    settingsMenu.open = false;
  });
}

rectToolBtn.addEventListener("click", () => setCaptureTool("rect"));
lassoToolBtn.addEventListener("click", () => setCaptureTool("lasso"));

mapresModeSelect.addEventListener("change", () => {
  const oldMode = state.mapresMode;
  state.mapresMode = mapresModeSelect.value;

  if (state.mapLoaded && oldMode !== state.mapresMode) {
    alert("Mapres mode changed. It will apply the next time you load a map.");
  }

  queueAutosave();
});

if (autoCaptureToggle) {
  autoCaptureToggle.addEventListener("change", () => {
    state.autoCaptureEnabled = autoCaptureToggle.checked;
    queueAutosave();
  });
}

if (viewModeSelect) {
  viewModeSelect.addEventListener("change", () => {
    state.viewMode = viewModeSelect.value;
    applyEntitySettingsToOverlay();
    updateMixedOpacityControlState();
    queueAutosave();
  });
}

if (mixedOpacityInput) {
  mixedOpacityInput.addEventListener("input", () => {
    state.mixedOpacity = Number(mixedOpacityInput.value) / 100;
    applyEntitySettingsToOverlay();
    queueAutosave();
  });
}

if (showEntityNumbersToggle) {
  showEntityNumbersToggle.addEventListener("change", () => {
    state.showEntityNumbers = showEntityNumbersToggle.checked;
    applyEntitySettingsToOverlay();
    queueAutosave();
  });
}

function wireLayerToggle(element, layerKey) {
  if (!element) {
    return;
  }
  element.addEventListener("change", () => {
    state.entityLayerVisibility[layerKey] = element.checked;
    applyEntitySettingsToOverlay();
    queueAutosave();
  });
}

wireLayerToggle(layerGameToggle, "game");
wireLayerToggle(layerFrontToggle, "front");
wireLayerToggle(layerTeleToggle, "tele");
wireLayerToggle(layerSpeedupToggle, "speedup");
wireLayerToggle(layerSwitchToggle, "switch");
wireLayerToggle(layerTuneToggle, "tune");

if (entitiesUploadInput) {
  entitiesUploadInput.addEventListener("change", async () => {
    const file = entitiesUploadInput.files?.[0];
    if (!file) {
      return;
    }

    try {
      await entityOverlay.loadCustomAtlasFile(file);
      showToast("Custom entities atlas loaded");
      queueAutosave();
    } catch (error) {
      console.error(error);
      alert(`Could not load entities atlas: ${error.message}`);
    } finally {
      entitiesUploadInput.value = "";
    }
  });
}

if (entitiesResetBtn) {
  entitiesResetBtn.addEventListener("click", async () => {
    try {
      await entityOverlay.resetAtlasToDefault();
      showToast("Entities atlas reset to default");
      queueAutosave();
    } catch (error) {
      console.error(error);
      alert(`Could not reset entities atlas: ${error.message}`);
    }
  });
}

if (clearRecoveryBtn) {
  clearRecoveryBtn.addEventListener("click", () => {
    if (!confirm("Clear all recovered screenshots and start fresh?")) {
      return;
    }
    
    screenshotManager.clear();
    localStorage.removeItem(AUTOSAVE_KEY);
    if (!state.mapLoaded) {
      mapNameBadge.textContent = "No map loaded";
    }
    updateClearRecoveryButtonVisibility();
    viewerHint.textContent = "Upload a map to start the interactive viewer.";
    showToast("Recovered data cleared");
  });
}

window.addEventListener("beforeunload", (event) => {
  if (suppressUnloadPrompt) {
    return;
  }
  if (!screenshotManager.hasScreenshots()) {
    return;
  }
  event.preventDefault();
  event.returnValue = "";
});

async function initializeApp() {
  setCaptureTool("rect");
  await entityOverlay.initialize();
  applyEntitySettings(buildEntitySettings());

  const pendingPayload = await consumePendingSwitchPayload();
  if (pendingPayload?.arrayBuffer && pendingPayload?.fileName) {
    if (pendingPayload.mapresMode === "embedded" || pendingPayload.mapresMode === "bundled") {
      state.mapresMode = pendingPayload.mapresMode;
      mapresModeSelect.value = pendingPayload.mapresMode;
    }

    state.autoCaptureEnabled = Boolean(pendingPayload.autoCaptureEnabled);
    if (autoCaptureToggle) {
      autoCaptureToggle.checked = state.autoCaptureEnabled;
    }

    applyEntitySettings(pendingPayload.entityView);

    if (pendingPayload.keepScreenshots && Array.isArray(pendingPayload.screenshots)) {
      await screenshotManager.loadSerializableProject(pendingPayload.screenshots);
    }

    try {
      viewerHint.textContent = "Loading switched map...";
      await loadMapFromArrayBuffer(pendingPayload.arrayBuffer, pendingPayload.fileName);
      return;
    } catch (error) {
      console.error(error);
      alert(`Failed to load switched map: ${error.message}`);
    }
  }

  await switchDbDelete(SWITCH_PAYLOAD_KEY).catch(() => {});
  await restoreAutosaveDraft();
  updateClearRecoveryButtonVisibility();
}

appInitializationPromise = initializeApp()
  .catch((error) => {
    console.warn("Initialization encountered an issue.", error);
  })
  .finally(() => {
    appInitializationPromise = null;
  });
void appInitializationPromise;
