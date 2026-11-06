#!/usr/bin/env node
/* Turns the lab's Blender GLB exports into small, geometry-only web models.

   Usage: node scripts/build-appliance-models.mjs "<folder holding the GLB exports>"
   Output: public/models/appliances/<key>.glb and <key>-wire.glb (a low-poly mesh for the
   CAD view, because the full mesh is so dense that its wireframe fills in solid)

   What it does and why:
   - Keeps geometry only. Materials live in code (components/three/applianceMaterials.js),
     so one file covers every material variant of a device.
   - Names the parts `upper`, `lower` and `band-N`, so the page can move them apart.
   - Uses KHR_mesh_quantization and no Draco or Meshopt. Those decoders need WebAssembly
     (and a blob: worker for Draco), which the production CSP in apps/api/src/index.js
     blocks. Quantized meshes need no decoder and the server already Brotli-compresses
     model/* responses. */
import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO, getBounds } from "@gltf-transform/core";
import { KHRMeshQuantization, ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dequantize, flatten, prune, quantize, simplify, weld } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";

const DEVICES = [
  { key: "ddso-posterior", source: "DDSO-Posterior.glb" },
  { key: "ddso-anterior", source: "DDSO-Anterior.glb" },
  { key: "ond", source: "OND_Nylon-Trutaine.glb" },
  { key: "onp", source: "ONP_Trutaine.glb" },
];

/* Trays carry the visible detail budget. Bands are already light, so they are
   only welded. `error` is relative to the mesh size. */
const TRAY_RATIO = 0.3;
const TRAY_ERROR = 0.0006;
const WIRE_RATIO = 0.035;
const WIRE_ERROR = 0.012;

const sourceDir = process.argv[2];
if (!sourceDir) {
  console.error('Usage: node scripts/build-appliance-models.mjs "<folder holding the GLB exports>"');
  process.exit(1);
}
const outDir = fileURLToPath(new URL("../public/models/appliances/", import.meta.url));

function stripSurfaceData(document) {
  const root = document.getRoot();
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      prim.setAttribute("TEXCOORD_0", null);
      prim.setMaterial(null);
    }
  }
  root.listMaterials().forEach((m) => m.dispose());
  root.listTextures().forEach((t) => t.dispose());
}

function nameParts(document, materialByNode) {
  const scene = document.getRoot().getDefaultScene();
  const meshNodes = [];
  scene.traverse((node) => {
    if (node.getMesh()) meshNodes.push(node);
  });
  const bands = meshNodes.filter((n) => materialByNode.get(n.getName()) === "Titration band");
  const trays = meshNodes
    .filter((n) => !bands.includes(n))
    .sort((a, b) => getBounds(a).min[1] + getBounds(a).max[1] - (getBounds(b).min[1] + getBounds(b).max[1]));
  if (trays.length !== 2) throw new Error(`Expected 2 trays, found ${trays.length}`);
  trays[0].setName("lower");
  trays[1].setName("upper");
  bands.forEach((n, i) => n.setName(`band-${i + 1}`));
  return { trays, bands };
}

await mkdir(outDir, { recursive: true });
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

for (const { key, source } of DEVICES) {
  const input = join(sourceDir, source);
  const document = await io.read(input);
  const root = document.getRoot();

  const materialByNode = new Map();
  root.getDefaultScene().traverse((node) => {
    const material = node.getMesh()?.listPrimitives()[0]?.getMaterial();
    if (material) materialByNode.set(node.getName(), material.getName());
  });

  const parts = (() => {
    stripSurfaceData(document);
    return nameParts(document, materialByNode);
  })();

  await document.transform(flatten(), weld());

  const before = parts.trays.reduce((n, t) => n + t.getMesh().listPrimitives()[0].getAttribute("POSITION").getCount(), 0);
  // Simplify the trays only: gltf-transform's simplify applies to the whole document,
  // so bands are detached for the pass and put back afterwards.
  const bandMeshes = parts.bands.map((b) => [b, b.getMesh()]);
  bandMeshes.forEach(([b]) => b.setMesh(null));
  await document.transform(simplify({ simplifier: MeshoptSimplifier, ratio: TRAY_RATIO, error: TRAY_ERROR, lockBorder: false }));
  bandMeshes.forEach(([b, m]) => b.setMesh(m));
  const after = parts.trays.reduce((n, t) => n + t.getMesh().listPrimitives()[0].getAttribute("POSITION").getCount(), 0);

  await document.transform(
    quantize({ quantizePosition: 14, quantizeNormal: 12, pattern: /POSITION|NORMAL/ }),
    prune({ keepAttributes: true })
  );
  document.createExtension(KHRMeshQuantization).setRequired(true);

  const out = join(outDir, `${key}.glb`);
  await io.write(out, document);

  // Re-read the finished file so the wire model has the same part names and positions.
  const wire = await io.read(out);
  await wire.transform(dequantize(), weld({ overwrite: true }));
  for (const mesh of wire.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) prim.setAttribute("NORMAL", null);
  }
  await wire.transform(
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio: WIRE_RATIO, error: WIRE_ERROR }),
    quantize({ quantizePosition: 14 }),
    prune({ keepAttributes: true })
  );
  wire.createExtension(KHRMeshQuantization).setRequired(true);
  const wireOut = join(outDir, `${key}-wire.glb`);
  await io.write(wireOut, wire);
  console.log(`${key}-wire: ${((await stat(wireOut)).size / 1e3).toFixed(0)} KB`);
  const { size } = await stat(out);
  const b = getBounds(root.getDefaultScene());
  console.log(
    `${key}: tray verts ${before} -> ${after}, ${(size / 1e6).toFixed(2)} MB, ` +
      `bbox ${b.min.map((v) => v.toFixed(4))} .. ${b.max.map((v) => v.toFixed(4))}`
  );
}
