import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import { applianceUrl, extractParts } from "./applianceGeometry";

export { WORLD_SCALE } from "./applianceGeometry";

/* Loads an appliance GLB into named parts for the react-three-fiber scenes.

   Decoders stay off (false, false): the files need none, and instantiating one would
   trip the production CSP, which blocks WebAssembly. */

const cache = new Map();

export function useAppliance(key) {
  const { scene } = useGLTF(applianceUrl(key), false, false);
  return useMemo(() => {
    if (!cache.has(key)) cache.set(key, extractParts(scene));
    return cache.get(key);
  }, [key, scene]);
}

/* The same parts as a low-poly mesh, for drawing a wireframe. */
export function useApplianceWire(key) {
  return useAppliance(`${key}-wire`);
}
