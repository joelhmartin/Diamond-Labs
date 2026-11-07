import * as THREE from "three";

/* Physical materials for the lab's appliances, matched to the lab's reference photos.
   The GLBs in public/models/appliances are geometry only, so these are the single
   source of how nylon, Trutaine, Bioflex and the bands look in the browser.

   Every material accepts clipping planes and a shared `scan` uniform set, which lights
   the fragments at the scan plane's height so a sweep reads like a printing edge. */

export const NYLON_COLOR = "#E9E9E2";
export const BAND_COLOR = "#1D5EB8";

/* Read a palette token ("--brand-400") so the 3D scene follows the theme editor. */
export function tokenColor(name, fallback = "#ffffff") {
  const channels = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return channels ? new THREE.Color(`rgb(${channels.split(/\s+/).join(",")})`) : new THREE.Color(fallback);
}

export function createScanUniforms() {
  return {
    uScanY: { value: 0 },
    uScanOn: { value: 0 },
    uScanColor: { value: tokenColor("--brand-400") },
  };
}

const GRAIN_FREQUENCY = "110.0"; // cells per world unit: about the look of sintered powder on screen

function patchMaterial(material, { grain = 0, rim = 0, scan }) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, scan);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vFilmObject;\nvarying float vFilmWorldY;")
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvFilmObject = position;\nvFilmWorldY = (modelMatrix * vec4(position, 1.0)).y;"
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
         varying vec3 vFilmObject;
         varying float vFilmWorldY;
         uniform float uScanY;
         uniform float uScanOn;
         uniform vec3 uScanColor;
         vec3 filmHash(vec3 p) {
           p = fract(p * vec3(0.1031, 0.1030, 0.0973));
           p += dot(p, p.yxz + 33.33);
           return fract((p.xxy + p.yxx) * p.zyx);
         }
         float filmGrainFade(vec3 p) {
           return 1.0 - smoothstep(0.4, 1.6, fwidth(p.x) + fwidth(p.y) + fwidth(p.z));
         }`
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
         ${grain > 0 ? `
         vec3 filmGrainP = vFilmObject * ${GRAIN_FREQUENCY};
         float filmFade = filmGrainFade(filmGrainP);
         diffuseColor.rgb *= 1.0 - 0.018 * filmFade * filmHash(floor(filmGrainP)).x;` : ""}`
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
         ${grain > 0 ? `normal = normalize(normal + (filmHash(floor(filmGrainP) + 7.0) - 0.5) * ${grain.toFixed(3)} * filmFade);` : ""}`
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
         totalEmissiveRadiance += uScanColor * uScanOn * 2.4 * smoothstep(0.028, 0.0, abs(vFilmWorldY - uScanY));
         ${rim > 0 ? `totalEmissiveRadiance += vec3(0.93, 0.97, 1.0) * ${rim.toFixed(3)} * pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 2.6);` : ""}`
      );
  };
  material.customProgramCacheKey = () => `appliance-${grain}-${rim}`;
  return material;
}

/* A set of every look an appliance can take, sharing one clipping plane.
   `lowPower` swaps real transmission for plain alpha, which phones draw far faster. */
export function createMaterialSet({ plane, scan, lowPower = false }) {
  const clippingPlanes = [plane];

  const clear = (props, alpha) =>
    lowPower
      ? new THREE.MeshPhysicalMaterial({
          color: props.color,
          roughness: props.roughness,
          transparent: true,
          opacity: alpha,
          depthWrite: false,
          side: THREE.DoubleSide,
          envMapIntensity: 1.6,
          clearcoat: 1,
          clippingPlanes,
        })
      : new THREE.MeshPhysicalMaterial({
          transmission: 1,
          ...props,
          metalness: 0,
          side: THREE.DoubleSide,
          clippingPlanes,
        });

  return {
    nylon: patchMaterial(
      new THREE.MeshStandardMaterial({
        color: NYLON_COLOR,
        roughness: 0.62,
        metalness: 0,
        side: THREE.DoubleSide,
        envMapIntensity: 1.2,
        clippingPlanes,
      }),
      { grain: 0.045, scan }
    ),
    band: patchMaterial(
      new THREE.MeshStandardMaterial({
        color: BAND_COLOR,
        roughness: 0.42,
        metalness: 0,
        side: THREE.DoubleSide,
        clippingPlanes,
      }),
      { grain: 0.02, scan }
    ),
    trutaine: patchMaterial(
      clear(
        {
          color: "#f4f9fc",
          roughness: 0.05,
          ior: 1.54,
          thickness: 0.07,
          attenuationColor: new THREE.Color("#eaf3fa"),
          attenuationDistance: 4,
          envMapIntensity: 1.5,
        },
        0.3
      ),
      { rim: 0.75, scan }
    ),
    bioflex: patchMaterial(
      clear(
        {
          color: "#eef3f5",
          roughness: 0.24,
          ior: 1.5,
          thickness: 0.09,
          transmission: 0.9,
          attenuationColor: new THREE.Color("#eef2f5"),
          attenuationDistance: 1.6,
          envMapIntensity: 1.6,
        },
        0.48
      ),
      { rim: 0.5, scan }
    ),
    points: new THREE.PointsMaterial({
      color: tokenColor("--brand-300"),
      size: 0.011,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      clippingPlanes,
    }),
    wire: new THREE.MeshBasicMaterial({
      color: tokenColor("--brand-400"),
      wireframe: true,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      clippingPlanes,
    }),
    // Writes depth only, so a wireframe shows its near surface like a CAD view.
    occluder: new THREE.MeshBasicMaterial({
      colorWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: 2,
      polygonOffsetUnits: 2,
      clippingPlanes,
    }),
  };
}

export function disposeMaterialSet(set) {
  Object.values(set).forEach((m) => m.dispose());
}
