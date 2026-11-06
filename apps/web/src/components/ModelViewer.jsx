import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { prefersReducedMotion } from "../lib/reducedMotion";

/**
 * ModelViewer — renders a GLB file in a Three.js canvas.
 * The models carry their own PBR materials. The clear ones (Trutaine, Bioflex)
 * get their look from reflections, so the scene needs an environment map.
 * Props:
 *   modelPath — path to the .glb file (relative to /public)
 *   className — extra Tailwind classes for the wrapper div. Set a solid bg-* and the
 *     status text colour here. The scene copies that background, because clear
 *     materials can only refract what is drawn inside the scene.
 */
export function ModelViewer({ modelPath, className = "", interactive = true }) {
  const mountRef = useRef(null);
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;
    setStatus("loading");

    const width = mount.clientWidth;
    const height = mount.clientHeight;

    /* ── Renderer ── */
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1;
    mount.appendChild(renderer.domElement);

    /* ── Scene ── */
    const scene = new THREE.Scene();
    const stageColor = getComputedStyle(mount).backgroundColor;
    if (stageColor && !stageColor.endsWith(", 0)") && stageColor !== "transparent") {
      scene.background = new THREE.Color(stageColor);
    }
    const pmrem = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envMap = pmrem.fromScene(roomEnv, 0.04).texture;
    scene.environment = envMap;
    scene.environmentIntensity = 0.55;

    /* ── Camera ── */
    const camera = new THREE.PerspectiveCamera(35, width / height, 0.01, 1000);
    camera.position.set(0, 0, 5);

    /* ── Lighting: a soft key on top of the environment ── */
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(3, 6, 4);
    scene.add(key);

    /* ── Controls ── */
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 0.5;
    controls.maxDistance = 20;
    controls.autoRotate = !prefersReducedMotion();
    controls.autoRotateSpeed = 1.2;
    if (!interactive) {
      controls.enabled = false;
      renderer.domElement.style.pointerEvents = "none";
    }

    /* ── Load model ── */
    let disposed = false;
    let model = null;

    new GLTFLoader().load(
      modelPath,
      (gltf) => {
        model = gltf.scene;
        if (disposed) {
          disposeObject(model);
          return;
        }

        /* Fit model using bounding sphere — guarantees no overflow at any rotation */
        const box = new THREE.Box3().setFromObject(model);
        const sphere = box.getBoundingSphere(new THREE.Sphere());
        const targetRadius = 1;
        const scale = targetRadius / sphere.radius;
        model.scale.multiplyScalar(scale);
        model.position.sub(sphere.center.clone().multiplyScalar(scale));
        tuneClearMaterials(model, scale, envMap);
        scene.add(model);

        /* Camera distance fits the bounding sphere with padding,
           accounting for the smaller of vertical/horizontal FOV */
        const fovV = THREE.MathUtils.degToRad(camera.fov);
        const fovH = 2 * Math.atan(Math.tan(fovV / 2) * camera.aspect);
        const dist = (targetRadius * 1.02) / Math.sin(Math.min(fovV, fovH) / 2);
        camera.position.copy(new THREE.Vector3(0.55, 0.35, 1).normalize().multiplyScalar(dist));
        camera.near = Math.max(dist * 0.01, 0.001);
        camera.far = dist * 100;
        camera.updateProjectionMatrix();
        controls.update();
        setStatus("ready");
      },
      undefined,
      (err) => {
        console.error("[ModelViewer] GLB load error:", err);
        if (!disposed) setStatus("error");
      }
    );

    /* ── Animate ── */
    let animId;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    /* ── Resize ── */
    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    ro.observe(mount);

    /* ── Cleanup ── */
    return () => {
      disposed = true;
      cancelAnimationFrame(animId);
      ro.disconnect();
      controls.dispose();
      if (model) disposeObject(model);
      roomEnv.dispose();
      envMap.dispose();
      pmrem.dispose();
      renderer.dispose();
      if (mount.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, [modelPath, interactive]);

  return (
    <div ref={mountRef} className={`w-full h-full relative ${className}`}>
      {status === "loading" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10 pointer-events-none">
          <div className="w-8 h-8 rounded-full border-2 border-surface-300 border-t-brand-500 animate-spin" />
          <span className="text-xs">Loading 3D model</span>
        </div>
      )}
      {status === "error" && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <span className="text-sm">The 3D view couldn&apos;t load. Try the photos instead.</span>
        </div>
      )}
    </div>
  );
}

/* The models are real scale (metres) and get scaled up to fit. three.js scales a
   clear material's thickness with the model but not its attenuation distance, so
   it has to be scaled here or the plastic turns dark. Clear parts have little of
   their own to show, so they also get stronger reflections and their back faces. */
function tuneClearMaterials(root, scale, envMap) {
  const seen = new Set();
  root.traverse((child) => {
    if (!child.isMesh || seen.has(child.material) || !child.material.transmission) return;
    seen.add(child.material);
    child.material.attenuationDistance *= scale;
    child.material.envMap = envMap;
    child.material.envMapIntensity = 1.6;
    child.material.side = THREE.DoubleSide;
    child.material.needsUpdate = true;
  });
}

/* Switching between models would otherwise leak each one's GPU buffers. */
function disposeObject(root) {
  root.traverse((child) => {
    if (!child.isMesh) return;
    child.geometry.dispose();
    for (const material of [child.material].flat()) {
      for (const value of Object.values(material)) {
        if (value?.isTexture) value.dispose();
      }
      material.dispose();
    }
  });
}
