import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const BASE_06 = "https://mapview.patiga.eu/mapres_06";
const BASE_07 = "https://mapview.patiga.eu/mapres_07";

const commonNames = [
  "bg_cloud1",
  "bg_cloud2",
  "bg_cloud3",
  "desert_doodads",
  "desert_main",
  "desert_mountains2",
  "desert_mountains",
  "desert_sun",
  "generic_deathtiles",
  "generic_unhookable",
  "grass_doodads",
  "grass_main",
  "jungle_background",
  "jungle_deathtiles",
  "jungle_doodads",
  "jungle_main",
  "jungle_midground",
  "jungle_unhookables",
  "moon",
  "mountains",
  "snow",
  "stars",
  "sun",
  "winter_doodads",
  "winter_main",
  "winter_mountains2",
  "winter_mountains3",
  "winter_mountains"
];

const extra07 = ["easter", "generic_lamps", "generic_shadows", "light"];

async function ensureDir(relativePath) {
  const dir = path.join(root, relativePath);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function downloadTo(url, outPath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  await fs.writeFile(outPath, bytes);
}

async function fetchSet(version, baseUrl, names) {
  const outDir = await ensureDir(`public/mapres_${version}`);
  const failures = [];

  for (const name of names) {
    const fileName = `${name}.png`;
    const url = `${baseUrl}/${fileName}`;
    const outPath = path.join(outDir, fileName);

    try {
      await downloadTo(url, outPath);
      console.log(`[ok] ${version}/${fileName}`);
    } catch (error) {
      failures.push({ fileName, error: error.message });
      console.log(`[fail] ${version}/${fileName}: ${error.message}`);
    }
  }

  return failures;
}

async function main() {
  console.log("Fetching mapres assets...");
  const failures06 = await fetchSet("06", BASE_06, commonNames);
  const failures07 = await fetchSet("07", BASE_07, [...commonNames, ...extra07]);

  const allFailures = [...failures06, ...failures07];
  if (allFailures.length > 0) {
    console.log("Done with some failures:");
    for (const failure of allFailures) {
      console.log(` - ${failure.fileName}: ${failure.error}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("All mapres assets downloaded into public/mapres_06 and public/mapres_07.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
