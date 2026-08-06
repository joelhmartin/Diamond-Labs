import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

/**
 * ModelViewer — renders an OBJ+MTL file in a Three.js canvas.
 * Props:
 *   objPath  — path to the .obj file (relative to /public)
 *   mtlPath  — path to the .mtl file (relative to /public), optional
 *   className — extra Tailwind classes for the wrapper div
 */
export function ModelViewer({ objPath, mtlPath, className = "", interactive = true }) {
  const mountRef = useRef(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const width = mount.clientWidth;
    const height = mount.clientHeight;

    /* ── Renderer ── */
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    mount.appendChild(renderer.domElement);

    /* ── Scene ── */
    const scene = new THREE.Scene();

    /* ── Camera ── */
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 1000);
    camera.position.set(0, 0, 5);

    /* ── Lighting ── */
    const ambient = new THREE.AmbientLight(0xffffff, 1.2);
    scene.add(ambient);

    const key = new THREE.DirectionalLight(0xffffff, 2.5);
    key.position.set(4, 6, 4);
    scene.add(key);

    const fill = new THREE.DirectionalLight(0xc8d8ff, 1.0);
    fill.position.set(-4, 2, -3);
    scene.add(fill);

    const rim = new THREE.DirectionalLight(0xfff0cc, 0.8);
    rim.position.set(0, -4, -5);
    scene.add(rim);

    /* ── Controls ── */
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 0.5;
    controls.maxDistance = 20;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.2;
    if (!interactive) {
      controls.enabled = false;
      renderer.domElement.style.pointerEvents = "none";
    }

    /* ── Load model ── */
    let animId;

    const loadObj = (materials) => {
      const loader = new OBJLoader();
      if (materials) loader.setMaterials(materials);

      loader.load(
        objPath,
        (obj) => {
          /* Fit model using bounding sphere — guarantees no overflow at any rotation */
          const box = new THREE.Box3().setFromObject(obj);
          const sphere = box.getBoundingSphere(new THREE.Sphere());
          const center = sphere.center.clone();
          const targetRadius = 1;
          const scale = targetRadius / sphere.radius;
          obj.scale.setScalar(scale);
          obj.position.sub(center.multiplyScalar(scale));

          /* Fallback material if MTL colours are dark/missing */
          if (!materials) {
            obj.traverse((child) => {
              if (child.isMesh) {
                child.material = new THREE.MeshStandardMaterial({
                  color: 0xe8e8e8,
                  roughness: 0.4,
                  metalness: 0.05,
                });
              }
            });
          }

          scene.add(obj);
          setLoading(false);

          /* Camera distance fits the bounding sphere with padding,
             accounting for the smaller of vertical/horizontal FOV */
          const fovV = camera.fov * (Math.PI / 180);
          const fovH = 2 * Math.atan(Math.tan(fovV / 2) * camera.aspect);
          const minFov = Math.min(fovV, fovH);
          const padding = 1.35;
          const dist = (targetRadius * padding) / Math.sin(minFov / 2);
          camera.position.set(0, 0, dist);
          camera.near = Math.max(dist * 0.01, 0.001);
          camera.far = dist * 100;
          camera.updateProjectionMatrix();
          controls.update();
        },
        undefined,
        (err) => console.error("[ModelViewer] OBJ load error:", err)
      );
    };

    if (mtlPath) {
      const mtlLoader = new MTLLoader();
      mtlLoader.load(
        mtlPath,
        (materials) => {
          materials.preload();
          loadObj(materials);
        },
        undefined,
        () => loadObj(null) // MTL failed → load without
      );
    } else {
      loadObj(null);
    }

    /* ── Animate ── */
    const animate = () => {
      animId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    /* ── Resize ── */
    const onResize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(mount);

    /* ── Cleanup ── */
    return () => {
      cancelAnimationFrame(animId);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      if (mount.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, [objPath, mtlPath, interactive]);

  return (
    <div ref={mountRef} className={`w-full h-full relative ${className}`}>
      {loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10 pointer-events-none">
          <div className="w-8 h-8 rounded-full border-2 border-surface-300 border-t-brand-500 animate-spin" />
          <span className="font-mono text-[10px] text-navy/30 uppercase tracking-widest">Loading 3D model</span>
        </div>
      )}
    </div>
  );
}
