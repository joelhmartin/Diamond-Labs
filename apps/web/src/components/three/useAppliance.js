import { useMemo } from "react";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";

/* Loads an appliance GLB from public/models/appliances into named parts.

   Geometry comes back in plain float attributes at "world" scale: real millimetres
   times WORLD_SCALE, standing on y = 0, so a device is about 2 units wide whichever
   file it came from. Files are built by apps/web/scripts/build-appliance-models.mjs.

   Decoders stay off (false, false): the files need none, and instantiating one would
   trip the production CSP, which blocks WebAssembly. */

export const WORLD_SCALE = 30; // world units per metre
const url = (key) => `/models/appliances/${key}.glb`;
const cache = new Map();

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

function extractParts(scene) {
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

export function useAppliance(key) {
  const { scene } = useGLTF(url(key), false, false);
  return useMemo(() => {
    if (!cache.has(key)) cache.set(key, extractParts(scene));
    return cache.get(key);
  }, [key, scene]);
}

/* The same parts as a low-poly mesh, for drawing a wireframe. */
export function useApplianceWire(key) {
  return useAppliance(`${key}-wire`);
}
