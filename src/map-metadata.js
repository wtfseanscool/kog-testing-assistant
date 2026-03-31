import pako from "pako";

const DECODER = new TextDecoder("utf-8", { fatal: false });

function readI32(view, offset) {
  return view.getInt32(offset, true);
}

function parseHeader(buffer) {
  if (buffer.byteLength < 36) {
    throw new Error("File is too small to be a valid DDNet map.");
  }

  const view = new DataView(buffer);
  const magic = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3)
  );

  if (magic !== "DATA" && magic !== "ATAD") {
    throw new Error("Invalid map file magic. Expected DATA/ATAD.");
  }

  const formatVersion = readI32(view, 4);
  if (formatVersion !== 3 && formatVersion !== 4) {
    throw new Error(`Unsupported map datafile version: ${formatVersion}`);
  }

  const numItemTypes = readI32(view, 16);
  const numItems = readI32(view, 20);
  const numData = readI32(view, 24);
  const itemSize = readI32(view, 28);
  const dataSize = readI32(view, 32);

  if (
    numItemTypes < 0 ||
    numItems < 0 ||
    numData < 0 ||
    itemSize < 0 ||
    dataSize < 0
  ) {
    throw new Error("Map header has invalid negative size/count values.");
  }

  return {
    view,
    formatVersion,
    numItemTypes,
    numItems,
    numData,
    itemSize,
    dataSize
  };
}

function getTableOffsets(header) {
  const {
    formatVersion,
    numItemTypes,
    numItems,
    numData,
    itemSize
  } = header;

  let cursor = 36;

  const itemTypesOffset = cursor;
  cursor += numItemTypes * 12;

  const itemOffsetsOffset = cursor;
  cursor += numItems * 4;

  const dataOffsetsOffset = cursor;
  cursor += numData * 4;

  let dataSizesOffset = -1;
  if (formatVersion === 4) {
    dataSizesOffset = cursor;
    cursor += numData * 4;
  }

  const itemsOffset = cursor;
  const dataCompressedOffset = itemsOffset + itemSize;

  return {
    itemTypesOffset,
    itemOffsetsOffset,
    dataOffsetsOffset,
    dataSizesOffset,
    itemsOffset,
    dataCompressedOffset
  };
}

function parseItems(header, tables) {
  const { view, numItems } = header;
  const items = [];

  for (let i = 0; i < numItems; i += 1) {
    const rel = readI32(view, tables.itemOffsetsOffset + i * 4);
    const itemOffset = tables.itemsOffset + rel;
    const typeIdPacked = readI32(view, itemOffset);
    const sizeBytes = readI32(view, itemOffset + 4);

    if (sizeBytes < 0 || sizeBytes % 4 !== 0) {
      continue;
    }

    const dataCount = sizeBytes / 4;
    const data = new Int32Array(dataCount);
    let dataCursor = itemOffset + 8;
    for (let j = 0; j < dataCount; j += 1) {
      data[j] = readI32(view, dataCursor);
      dataCursor += 4;
    }

    items.push({
      typeId: (typeIdPacked >>> 16) & 0xffff,
      id: typeIdPacked & 0xffff,
      data
    });
  }

  return items;
}

function getDataItems(header, tables, arrayBuffer) {
  const { view, numData, formatVersion, dataSize } = header;
  const dataItems = [];

  if (formatVersion === 3) {
    const dataBytes = new Uint8Array(arrayBuffer, tables.dataCompressedOffset, dataSize);

    for (let i = 0; i < numData; i += 1) {
      const start = readI32(view, tables.dataOffsetsOffset + i * 4);
      const end =
        i + 1 < numData
          ? readI32(view, tables.dataOffsetsOffset + (i + 1) * 4)
          : dataBytes.byteLength;

      if (start < 0 || end < start || end > dataBytes.byteLength) {
        dataItems.push(new Uint8Array());
        continue;
      }
      dataItems.push(dataBytes.subarray(start, end));
    }
    return dataItems;
  }

  const compressedData = new Uint8Array(arrayBuffer, tables.dataCompressedOffset, dataSize);

  for (let i = 0; i < numData; i += 1) {
    const start = readI32(view, tables.dataOffsetsOffset + i * 4);
    const end =
      i + 1 < numData
        ? readI32(view, tables.dataOffsetsOffset + (i + 1) * 4)
        : compressedData.byteLength;

    if (start < 0 || end < start || end > compressedData.byteLength) {
      dataItems.push(new Uint8Array());
      continue;
    }

    const expectedSize =
      tables.dataSizesOffset >= 0
        ? readI32(view, tables.dataSizesOffset + i * 4)
        : -1;

    try {
      const inflated = pako.inflate(compressedData.subarray(start, end));
      if (expectedSize > 0 && inflated.byteLength !== expectedSize) {
        dataItems.push(inflated.subarray(0, expectedSize));
      } else {
        dataItems.push(inflated);
      }
    } catch {
      dataItems.push(new Uint8Array());
    }
  }

  return dataItems;
}

function readCString(dataItems, index) {
  if (index == null || index < 0 || index >= dataItems.length) {
    return "";
  }

  const bytes = dataItems[index];
  let end = 0;
  while (end < bytes.byteLength && bytes[end] !== 0) {
    end += 1;
  }

  try {
    return DECODER.decode(bytes.subarray(0, end)).trim();
  } catch {
    return "";
  }
}

function getInfoItem(items) {
  return items.find((item) => item.typeId === 1 && item.id === 0) ?? null;
}

const TILE_LAYER_KIND_BY_FLAG = {
  0: "tiles",
  1: "game",
  2: "tele",
  4: "speedup",
  8: "front",
  16: "switch",
  32: "tune"
};

const TILE_LAYER_DATA_INDEX = {
  tiles: 14,
  game: 14,
  tele: 18,
  speedup: 19,
  front: 20,
  switch: 21,
  tune: 22
};

function inferTileLayerKind(layerItem) {
  if (layerItem.typeId !== 5 || layerItem.data.length < 7) {
    return null;
  }

  if (layerItem.data[1] !== 2) {
    return null;
  }

  return TILE_LAYER_KIND_BY_FLAG[layerItem.data[6]] ?? null;
}

function getLayerDataItemIndex(layerItem, layerKind) {
  const baseIndex = TILE_LAYER_DATA_INDEX[layerKind];
  if (baseIndex == null) {
    return -1;
  }

  const version = layerItem.data[3] ?? 1;
  const index = version >= 3 || baseIndex <= 14 ? baseIndex : baseIndex - 3;
  if (index < 0 || index >= layerItem.data.length) {
    return -1;
  }

  return layerItem.data[index];
}

function decodeGameLikeTiles(layerBytes, totalTiles, allowSkipCompression) {
  const ids = new Uint8Array(totalTiles);
  const flags = new Uint8Array(totalTiles);

  if (!layerBytes || layerBytes.byteLength === 0 || totalTiles <= 0) {
    return { ids, flags };
  }

  const entries = Math.floor(layerBytes.byteLength / 4);
  if (entries >= totalTiles || !allowSkipCompression) {
    const limit = Math.min(totalTiles, entries);
    for (let i = 0; i < limit; i += 1) {
      const base = i * 4;
      ids[i] = layerBytes[base] ?? 0;
      flags[i] = layerBytes[base + 1] ?? 0;
    }
    return { ids, flags };
  }

  let tileIndex = 0;
  for (let entry = 0; entry < entries && tileIndex < totalTiles; entry += 1) {
    const base = entry * 4;
    const id = layerBytes[base] ?? 0;
    const flag = layerBytes[base + 1] ?? 0;
    const skip = layerBytes[base + 2] ?? 0;
    const repeat = Math.max(1, skip + 1);

    for (let i = 0; i < repeat && tileIndex < totalTiles; i += 1) {
      ids[tileIndex] = id;
      flags[tileIndex] = flag;
      tileIndex += 1;
    }
  }

  return { ids, flags };
}

function decodeTeleTiles(layerBytes, totalTiles) {
  const ids = new Uint8Array(totalTiles);
  const numbers = new Uint8Array(totalTiles);

  if (!layerBytes || layerBytes.byteLength === 0 || totalTiles <= 0) {
    return { ids, numbers };
  }

  const stride = layerBytes.byteLength >= totalTiles * 4 ? 4 : 2;
  const maxTiles = Math.min(totalTiles, Math.floor(layerBytes.byteLength / stride));
  for (let tileIndex = 0; tileIndex < maxTiles; tileIndex += 1) {
    const offset = tileIndex * stride;
    numbers[tileIndex] = layerBytes[offset] ?? 0;
    ids[tileIndex] = layerBytes[offset + 1] ?? 0;
  }

  return { ids, numbers };
}

function decodeSwitchTiles(layerBytes, totalTiles) {
  const ids = new Uint8Array(totalTiles);
  const numbers = new Uint8Array(totalTiles);
  const flags = new Uint8Array(totalTiles);
  const delays = new Uint8Array(totalTiles);

  if (!layerBytes || layerBytes.byteLength === 0 || totalTiles <= 0) {
    return { ids, numbers, flags, delays };
  }

  let stride = 0;
  if (layerBytes.byteLength >= totalTiles * 4) {
    stride = 4;
  } else if (layerBytes.byteLength >= totalTiles * 3) {
    stride = 3;
  } else if (layerBytes.byteLength >= totalTiles * 2) {
    stride = 2;
  }

  if (stride === 0) {
    return { ids, numbers, flags, delays };
  }

  const maxTiles = Math.min(totalTiles, Math.floor(layerBytes.byteLength / stride));
  for (let tileIndex = 0; tileIndex < maxTiles; tileIndex += 1) {
    const offset = tileIndex * stride;
    numbers[tileIndex] = layerBytes[offset] ?? 0;
    ids[tileIndex] = layerBytes[offset + 1] ?? 0;
    flags[tileIndex] = stride >= 3 ? layerBytes[offset + 2] ?? 0 : 0;
    delays[tileIndex] = stride >= 4 ? layerBytes[offset + 3] ?? 0 : 0;
  }

  return { ids, numbers, flags, delays };
}

function decodeSpeedupTiles(layerBytes, totalTiles) {
  const ids = new Uint8Array(totalTiles);
  const force = new Uint8Array(totalTiles);
  const maxSpeed = new Uint8Array(totalTiles);
  const angles = new Int16Array(totalTiles);

  if (!layerBytes || layerBytes.byteLength === 0 || totalTiles <= 0) {
    return { ids, force, maxSpeed, angles };
  }

  const stride = layerBytes.byteLength >= totalTiles * 6 ? 6 : layerBytes.byteLength >= totalTiles * 4 ? 4 : 0;
  if (stride === 0) {
    return { ids, force, maxSpeed, angles };
  }

  const maxTiles = Math.min(totalTiles, Math.floor(layerBytes.byteLength / stride));
  for (let tileIndex = 0; tileIndex < maxTiles; tileIndex += 1) {
    const offset = tileIndex * stride;
    force[tileIndex] = layerBytes[offset] ?? 0;

    if (stride >= 6) {
      maxSpeed[tileIndex] = layerBytes[offset + 1] ?? 0;
      ids[tileIndex] = layerBytes[offset + 2] ?? 0;
      angles[tileIndex] = (layerBytes[offset + 4] ?? 0) | ((layerBytes[offset + 5] ?? 0) << 8);
    } else {
      maxSpeed[tileIndex] = 0;
      ids[tileIndex] = 28;
      angles[tileIndex] = (layerBytes[offset + 2] ?? 0) | ((layerBytes[offset + 3] ?? 0) << 8);
    }
  }

  return { ids, force, maxSpeed, angles };
}

function decodeTuneTiles(layerBytes, totalTiles) {
  const ids = new Uint8Array(totalTiles);
  const numbers = new Uint8Array(totalTiles);

  if (!layerBytes || layerBytes.byteLength === 0 || totalTiles <= 0) {
    return { ids, numbers };
  }

  const stride = layerBytes.byteLength >= totalTiles * 4 ? 4 : 2;
  const maxTiles = Math.min(totalTiles, Math.floor(layerBytes.byteLength / stride));
  for (let tileIndex = 0; tileIndex < maxTiles; tileIndex += 1) {
    const offset = tileIndex * stride;
    numbers[tileIndex] = layerBytes[offset] ?? 0;
    ids[tileIndex] = layerBytes[offset + 1] ?? 0;
  }

  return { ids, numbers };
}

function decodePhysicsLayer(layerKind, layerBytes, totalTiles, allowSkipCompression) {
  if (layerKind === "game" || layerKind === "front") {
    return {
      kind: layerKind,
      ...decodeGameLikeTiles(layerBytes, totalTiles, allowSkipCompression)
    };
  }

  if (layerKind === "tele") {
    return {
      kind: layerKind,
      ...decodeTeleTiles(layerBytes, totalTiles)
    };
  }

  if (layerKind === "switch") {
    return {
      kind: layerKind,
      ...decodeSwitchTiles(layerBytes, totalTiles)
    };
  }

  if (layerKind === "speedup") {
    return {
      kind: layerKind,
      ...decodeSpeedupTiles(layerBytes, totalTiles)
    };
  }

  if (layerKind === "tune") {
    return {
      kind: layerKind,
      ...decodeTuneTiles(layerBytes, totalTiles)
    };
  }

  return null;
}

function parsePhysicsLayers(items, dataItems) {
  const result = {
    width: 0,
    height: 0,
    layers: {
      game: null,
      front: null,
      tele: null,
      speedup: null,
      switch: null,
      tune: null
    }
  };

  const tileLayers = items.filter((item) => item.typeId === 5 && item.data.length >= 15);
  for (const layerItem of tileLayers) {
    const layerKind = inferTileLayerKind(layerItem);
    if (!layerKind || layerKind === "tiles") {
      continue;
    }

    const width = layerItem.data[4] ?? 0;
    const height = layerItem.data[5] ?? 0;
    if (width <= 0 || height <= 0) {
      continue;
    }

    if (result.width === 0 || result.height === 0 || layerKind === "game") {
      result.width = width;
      result.height = height;
    }

    const dataIndex = getLayerDataItemIndex(layerItem, layerKind);
    if (dataIndex < 0 || dataIndex >= dataItems.length) {
      continue;
    }

    const layerBytes = dataItems[dataIndex];
    const totalTiles = width * height;
    const allowSkipCompression = layerKind === "game";
    const decoded = decodePhysicsLayer(layerKind, layerBytes, totalTiles, allowSkipCompression);
    if (!decoded) {
      continue;
    }

    result.layers[layerKind] = decoded;
  }

  return result;
}

function averageSpawnPosition(width, height, gameLayer) {
  if (width <= 0 || height <= 0 || !gameLayer?.ids) {
    return { x: 0, y: 0 };
  }

  const totalTiles = width * height;
  const ids = gameLayer.ids;

  let spawnSumX = 0;
  let spawnSumY = 0;
  let spawnCount = 0;

  const registerSpawn = (tileIndex, tileId) => {
    if (tileId < 192 || tileId > 194) {
      return;
    }
    const x = tileIndex % width;
    const y = Math.floor(tileIndex / width);
    spawnSumX += x;
    spawnSumY += y;
    spawnCount += 1;
  };

  const limit = Math.min(totalTiles, ids.length);
  for (let tileIndex = 0; tileIndex < limit; tileIndex += 1) {
    registerSpawn(tileIndex, ids[tileIndex]);
  }

  if (spawnCount === 0) {
    return { x: 0, y: 0 };
  }

  return {
    x: spawnSumX / spawnCount,
    y: spawnSumY / spawnCount
  };
}

function parseMapGeometry(items, dataItems) {
  const physicsLayers = parsePhysicsLayers(items, dataItems);
  const width = physicsLayers.width;
  const height = physicsLayers.height;
  const gameLayer = physicsLayers.layers.game;

  if (!gameLayer || width <= 0 || height <= 0) {
    return {
      width: 0,
      height: 0,
      startPosition: { x: 0, y: 0 },
      physicsLayers
    };
  }

  return {
    width,
    height,
    startPosition: averageSpawnPosition(width, height, gameLayer),
    physicsLayers
  };
}

function parseSettings(dataItems, settingsIndex) {
  if (settingsIndex == null || settingsIndex < 0 || settingsIndex >= dataItems.length) {
    return [];
  }

  const bytes = dataItems[settingsIndex];
  const settings = [];
  let start = 0;

  for (let i = 0; i < bytes.byteLength; i += 1) {
    if (bytes[i] !== 0) {
      continue;
    }
    if (i > start) {
      settings.push(DECODER.decode(bytes.subarray(start, i)).trim());
    }
    start = i + 1;
  }

  return settings.filter(Boolean);
}

function normalizeCandidateName(value) {
  return value
    .trim()
    .replace(/^['"]+|['"]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isPlausibleMapName(value) {
  if (!value || value.length < 2 || value.length > 80) {
    return false;
  }
  if (/^\d+$/.test(value)) {
    return false;
  }
  return true;
}

function inferMapName(settings, fallbackName) {
  const patterns = [
    /^mapname\s+(.+)$/i,
    /^title\s+(.+)$/i,
    /^name\s+(.+)$/i,
    /^sv_map\s+(.+)$/i
  ];

  for (const entry of settings) {
    for (const pattern of patterns) {
      const match = entry.match(pattern);
      if (!match || !match[1]) {
        continue;
      }
      const candidate = normalizeCandidateName(match[1]);
      if (isPlausibleMapName(candidate)) {
        return candidate;
      }
    }
  }

  return fallbackName;
}

export function parseMapMetadata(arrayBuffer, fileName) {
  const header = parseHeader(arrayBuffer);
  const tables = getTableOffsets(header);
  const items = parseItems(header, tables);
  const dataItems = getDataItems(header, tables, arrayBuffer);
  const infoItem = getInfoItem(items);
  const mapGeometry = parseMapGeometry(items, dataItems);

  const fallbackName = fileName.replace(/\.map$/i, "");
  if (!infoItem) {
    return {
      fileName,
      mapName: fallbackName,
      datafileVersion: header.formatVersion,
      mapGeometry,
      physicsLayers: mapGeometry.physicsLayers,
      info: {
        author: "",
        version: "",
        credits: "",
        license: "",
        settings: []
      }
    };
  }

  const d = infoItem.data;
  const info = {
    author: readCString(dataItems, d[1] ?? -1),
    version: readCString(dataItems, d[2] ?? -1),
    credits: readCString(dataItems, d[3] ?? -1),
    license: readCString(dataItems, d[4] ?? -1),
    settings: parseSettings(dataItems, d[5] ?? -1)
  };

  return {
    fileName,
    mapName: inferMapName(info.settings, fallbackName),
    datafileVersion: header.formatVersion,
    mapGeometry,
    physicsLayers: mapGeometry.physicsLayers,
    info
  };
}
