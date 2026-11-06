import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { prefersReducedMotion } from "../lib/reducedMotion";
import { applianceUrl, extractParts } from "./three/applianceGeometry";
import { createMaterialSet, createScanUniforms, disposeMaterialSet } from "./three/applianceMaterials";

/**
 * ModelViewer — renders one appliance in a Three.js canvas.
 * Props:
 *   model — { device, upper, lower }: a file in public/models/appliances and the look
 *     from applianceMaterials for each tray. Bands always use the band look.
 *   className — extra Tailwind classes for the wrapper div. Set a solid bg-* and the
 *     status text colour here. The scene copies that background, because clear
 *     materials can only refract what is drawn inside the scene.
 */
export function ModelViewer({ model: { device, upper, lower }, className = "", interactive = true }) {
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
    let parts = null;
    // No clipping in this viewer: renderer.localClippingEnabled stays off, so the plane is ignored.
    const materials = createMaterialSet({
      plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
      scan: createScanUniforms(),
    });

    new GLTFLoader().load(
      applianceUrl(device),
      (gltf) => {
        if (disposed) return;
        parts = extractParts(gltf.scene);
        const appliance = new THREE.Group();
        appliance.add(new THREE.Mesh(parts.upper, materials[upper]), new THREE.Mesh(parts.lower, materials[lower]));
        for (const band of parts.bands) appliance.add(new THREE.Mesh(band, materials.band));

        /* Fit using the bounding sphere, which guarantees no overflow at any rotation */
        const sphere = new THREE.Box3().setFromObject(appliance).getBoundingSphere(new THREE.Sphere());
        appliance.position.sub(sphere.center);
        scene.add(appliance);

        /* Camera distance fits the sphere with padding, for the smaller of the two FOVs */
        const fovV = THREE.MathUtils.degToRad(camera.fov);
        const fovH = 2 * Math.atan(Math.tan(fovV / 2) * camera.aspect);
        const dist = (sphere.radius * 1.02) / Math.sin(Math.min(fovV, fovH) / 2);
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
      if (parts) [parts.upper, parts.lower, ...parts.bands].forEach((geometry) => geometry.dispose());
      disposeMaterialSet(materials);
      roomEnv.dispose();
      envMap.dispose();
      pmrem.dispose();
      renderer.dispose();
      if (mount.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, [device, upper, lower, interactive]);

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
