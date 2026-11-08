import * as THREE from "three";

/* Turns a loaded appliance GLB (public/models/appliances, built by
   apps/web/scripts/build-appliance-models.mjs) into named parts.

   Geometry comes back in plain float attributes at "world" scale: real millimetres
   times WORLD_SCALE, standing on y = 0, so a device is about 2 units wide whichever
   file it came from. The materials in applianceMaterials.js are tuned to this scale. */

export const WORLD_SCALE = 30; // world units per metre
export const applianceUrl = (key) => `/models/appliances/${key}.glb`;

function toWorldGeometry(mesh) {
  const source = mesh.geometry;
  const matrix = new THREE.Matrix4().makeScale(WORLD_SCALE, WORLD_SCALE, WORLD_SCALE).multiply(mesh.matrixWorld);
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
  const { position, normal } = source.attributes;

  const positions = new Float32Array(position.count * 3);
  const normals = new Float32Array(position.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i).applyMatrix4(matrix).toArray(positions, i * 3);
    if (normal) v.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize().toArray(normals, i * 3);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  if (normal) geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setIndex(source.index);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function extractParts(scene) {
  const parts = { upper: null, lower: null, bands: [] };
  scene.updateMatrixWorld(true);
  scene.traverse((node) => {
    if (!node.isMesh) return;
    const geometry = toWorldGeometry(node);
    if (node.name.startsWith("upper")) parts.upper = geometry;
    else if (node.name.startsWith("lower")) parts.lower = geometry;
    else parts.bands.push(geometry);
  });
  if (!parts.upper || !parts.lower) throw new Error("Appliance GLB is missing its upper or lower part");
  return parts;
}
