import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import gsap from "gsap";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Html, Lightformer, PerformanceMonitor } from "@react-three/drei";
import { createMaterialSet, createScanUniforms, disposeMaterialSet, tokenColor } from "../../three/applianceMaterials";
import { useAppliance, useApplianceWire } from "../../three/useAppliance";
import { LOOKS } from "./filmScript";

/* The WebGL half of the appliance film, loaded as its own chunk so three.js stays out
   of every other page. It reads the live `film` values each frame and draws one or two
   looks of the appliance, split by a horizontal scan plane. */

const DEVICE_HEIGHT = 0.8; // world units, about what every appliance stands
const SWEEP_MARGIN = 0.22;
const CAMERA_FOV = 26;
const SIDES = ["above", "below"]; // each side of the scan plane has its own materials

/* Opening the device: each band sits over two discs on the trays, so it pulls straight
   out sideways before anything lifts. Otherwise it slides through the discs. Both are
   0..1 along film.open. */
const bandClear = (open) => THREE.MathUtils.smoothstep(open, 0, 0.3);
const trayLift = (open) => THREE.MathUtils.smoothstep(open, 0.22, 1);

/* The CAD view: low-poly lines over a depth-only copy that hides the far side. */
function WireParts({ device, materials }) {
  const wire = useApplianceWire(device);
  return [wire.upper, wire.lower, ...wire.bands].map((geometry) => (
    <group key={geometry.uuid}>
      <mesh geometry={geometry} material={materials.occluder} renderOrder={-1} />
      <mesh geometry={geometry} material={materials.wire} />
    </group>
  ));
}

/* One look of the appliance, in the materials of one side of the scan plane. */
function ApplianceLook({ look, side, rig, film }) {
  const parts = useAppliance(look.device);
  const materials = rig.sets[side];
  const upper = useRef();
  const lower = useRef();
  const bands = useRef([]);
  const switchable = look.tray === "variant";

  useFrame(() => {
    const clear = bandClear(film.open);
    const lift = trayLift(film.open);
    if (upper.current) upper.current.position.y = lift * 0.86;
    if (lower.current) lower.current.position.y = lift * 0.02;
    bands.current.forEach((band, i) => {
      if (!band) return;
      const direction = parts.bands[i].boundingBox.max.x + parts.bands[i].boundingBox.min.x > 0 ? 1 : -1;
      band.position.set(direction * clear * 0.5, lift * 0.46, 0);
    });
    if (switchable && upper.current) {
      upper.current.material = lower.current.material = materials[rig.variants[side]];
    }
  });

  const draw = (geometry, kind, ref, key) => {
    if (look.mode === "points") return <points key={key} ref={ref} geometry={geometry} material={materials.points} />;
    return <mesh key={key} ref={ref} geometry={geometry} material={materials[kind]} />;
  };
  const tray = (part) => (look.mode !== "solid" ? "nylon" : switchable ? film.variant : look.tray[part]);

  if (look.mode === "wire") return <WireParts device={look.device} materials={materials} />;

  return (
    <group rotation={[0, look.yawOffset ?? 0, 0]}>
      {draw(parts.upper, tray("upper"), upper, "upper")}
      {draw(parts.lower, tray("lower"), lower, "lower")}
      {parts.bands.map((g, i) => draw(g, "band", (el) => (bands.current[i] = el), `band-${i}`))}
    </group>
  );
}

/* The thin sheet of light that does every transformation in the film. */
function ScanPlane({ meshRef }) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: { uOn: { value: 0 }, uColor: { value: tokenColor("--brand-400") } },
        vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
        fragmentShader: `varying vec2 vUv; uniform float uOn; uniform vec3 uColor;
          void main(){
            float r = length((vUv - 0.5) * 2.0);
            float ring = smoothstep(0.965, 0.985, r) * (1.0 - smoothstep(0.985, 1.0, r));
            float body = (1.0 - smoothstep(0.2, 1.0, r)) * 0.12;
            gl_FragColor = vec4(uColor, (ring * 0.55 + body) * uOn);
          }`,
      }),
    []
  );
  useEffect(() => () => material.dispose(), [material]);
  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} material={material} visible={false}>
      <circleGeometry args={[1.5, 96]} />
    </mesh>
  );
}

/* Callouts pinned to the parts, shown while the trays are apart. */
function AnatomyLabels({ film }) {
  const parts = useAppliance("ddso-posterior");
  const wrap = useRef([]);
  const anchors = useMemo(() => {
    const top = parts.upper.boundingBox;
    const low = parts.lower.boundingBox;
    const band = parts.bands[0]?.boundingBox;
    return [
      { id: "upper", text: "Upper tray", detail: "Full-arch coverage", pos: [top.max.x * 0.9, top.max.y + 0.86, 0] },
      {
        id: "band",
        text: "Titration band",
        detail: "Adjustable nylon band",
        pos: band
          ? [(band.max.x + band.min.x) / 2 + Math.sign(band.max.x + band.min.x) * 0.5, (band.max.y + band.min.y) / 2 + 0.46, (band.max.z + band.min.z) / 2]
          : [1, 0.6, 0],
      },
      { id: "lower", text: "Lower tray", detail: "Nylon PA12, SLS printed", pos: [low.max.x * 0.9, low.min.y + 0.2, 0] },
    ];
  }, [parts]);

  useFrame(() => {
    const on = THREE.MathUtils.smoothstep(film.labels, 0.55, 1);
    wrap.current.forEach((el) => {
      if (!el) return;
      el.style.opacity = on;
      el.style.visibility = on < 0.01 ? "hidden" : "visible";
    });
  });

  return anchors.map((a, i) => (
    <Html key={a.id} position={a.pos} zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}>
      <div ref={(el) => (wrap.current[i] = el)} className="w-max -translate-y-1/2 flex items-center gap-1.5 sm:gap-2 opacity-0">
        <span className="block w-2 h-2 flex-shrink-0 rounded-full bg-accent-500 ring-4 ring-accent-500/25" />
        <span className="hidden sm:block w-5 h-px flex-shrink-0 bg-white/50" />
        <span className="block rounded-2xl bg-[rgb(7_23_45/0.72)] backdrop-blur-md border border-white/10 px-2.5 py-1.5 sm:px-3 sm:py-2">
          <span className="block text-white text-sm font-semibold leading-tight whitespace-nowrap">{a.text}</span>
          <span className="hidden sm:block text-white/70 font-mono text-[11px] leading-tight mt-0.5 whitespace-nowrap">{a.detail}</span>
        </span>
      </div>
    </Html>
  ));
}

function Backdrop() {
  const { scene } = useThree();
  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 640;
    const ctx = canvas.getContext("2d");
    const css = (c) => `#${c.getHexString()}`;
    const navy = tokenColor("--navy");
    const blue = tokenColor("--navy-dark");
    const deep = navy.clone().multiplyScalar(0.42);

    ctx.fillStyle = css(deep);
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const wash = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    wash.addColorStop(0, css(navy));
    wash.addColorStop(1, css(deep));
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const glow = ctx.createRadialGradient(660, 250, 10, 660, 250, 560);
    glow.addColorStop(0, `${css(blue)}a6`);
    glow.addColorStop(0.5, `${css(blue)}33`);
    glow.addColorStop(1, `${css(blue)}00`);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    scene.background = texture;
    return () => {
      scene.background = null;
      texture.dispose();
    };
  }, [scene]);
  return null;
}

/* The site's drifting diamonds, as slow planes far behind the device. */
const DIAMONDS = [
  { x: -6.5, y: 4.5, s: 8, speed: 0.05, phase: 0 },
  { x: 6.5, y: 2.2, s: 10, speed: 0.04, phase: 2 },
  { x: 0.5, y: -3.5, s: 7, speed: 0.06, phase: 4 },
];

function Diamonds() {
  const refs = useRef([]);
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: tokenColor("--brand-500"),
        transparent: true,
        opacity: 0.05,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    []
  );
  useEffect(() => () => material.dispose(), [material]);
  useFrame(({ clock }) => {
    refs.current.forEach((m, i) => {
      if (!m) return;
      const d = DIAMONDS[i];
      const t = clock.elapsedTime * d.speed + d.phase;
      m.position.set(d.x + Math.sin(t) * 0.9, d.y + Math.cos(t * 0.8) * 0.7, -8);
      m.rotation.z = Math.PI / 4 + Math.sin(t * 0.6) * 0.08;
    });
  });
  return DIAMONDS.map((d, i) => (
    <mesh key={i} ref={(el) => (refs.current[i] = el)} material={material} scale={d.s}>
      <planeGeometry />
    </mesh>
  ));
}

function radialTexture(stops) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  stops.forEach(([at, color]) => g.addColorStop(at, color));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(canvas);
}

/* A dark polished surface that melts into the backdrop, plus a soft contact shadow. */
function Floor({ film }) {
  const shadow = useRef();
  const textures = useMemo(
    () => ({
      fade: radialTexture([[0, "#fff"], [0.45, "#999"], [1, "#000"]]),
      blob: radialTexture([[0, "rgba(0,8,28,.75)"], [0.55, "rgba(0,8,28,.42)"], [1, "rgba(0,8,28,0)"]]),
    }),
    []
  );
  useEffect(() => () => Object.values(textures).forEach((t) => t.dispose()), [textures]);
  useFrame(() => {
    if (shadow.current) shadow.current.material.opacity = 1 - film.open * 0.45;
  });
  return (
    <group position={[0, -0.012, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[9, 64]} />
        <meshStandardMaterial color={tokenColor("--navy").multiplyScalar(0.3)} roughness={0.34} metalness={0.15} transparent alphaMap={textures.fade} envMapIntensity={0.3} />
      </mesh>
      <mesh ref={shadow} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]}>
        <planeGeometry args={[3.6, 3]} />
        <meshBasicMaterial map={textures.blob} transparent depthWrite={false} />
      </mesh>
    </group>
  );
}

/* A studio built from light cards, so no HDRI has to come from a CDN the CSP blocks. */
function Studio() {
  return (
    <>
      <Environment resolution={256} frames={1}>
        <color attach="background" args={["#0a1c3c"]} />
        <Lightformer form="rect" intensity={3.4} color="#ffffff" position={[1.5, 5, 2.5]} scale={[9, 6, 1]} rotation={[Math.PI / 2.4, 0, 0]} />
        <Lightformer form="rect" intensity={5} color="#ffffff" position={[-5.5, 1.6, 1]} scale={[1.2, 6, 1]} rotation={[0, Math.PI / 2, 0]} />
        <Lightformer form="rect" intensity={3} color="#bcd9ff" position={[5.5, 1.4, -2]} scale={[1.6, 6, 1]} rotation={[0, -Math.PI / 2, 0]} />
        <Lightformer form="rect" intensity={1.6} color="#7db8ff" position={[0, 1, -6]} scale={[12, 2.4, 1]} />
      </Environment>
      <ambientLight intensity={0.55} color="#f4f7ff" />
      <directionalLight position={[2.5, 5, 3.5]} intensity={1.35} />
    </>
  );
}

/* Every material's shader, built ahead of time so a first wipe does not stall the page. */
function compileMaterials(gl, camera, scene, sets) {
  const probe = new THREE.Scene();
  const geometry = new THREE.BoxGeometry();
  sets.forEach((set) =>
    Object.values(set).forEach((material) => probe.add(material.isPointsMaterial ? new THREE.Points(geometry, material) : new THREE.Mesh(geometry, material)))
  );
  const done = () => geometry.dispose();
  gl.compileAsync(probe, camera, scene).then(done, done);
}

function Film({ film, lowPower, allLooks }) {
  const { camera, gl, scene, size } = useThree();
  const device = useRef();
  const planeMesh = useRef();
  // Every look stays mounted and is shown from the render loop, in the same frame the plane
  // moves. Choosing them through React state let the plane release a frame before the old
  // look came off, which flashed whole devices on screen.
  const slots = useRef({ above: [], below: [] });

  const rig = useMemo(() => {
    const above = new THREE.Plane(new THREE.Vector3(0, 1, 0), 1000);
    const below = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1000);
    const scan = createScanUniforms();
    return {
      above,
      below,
      scan,
      variants: { above: film.variant, below: film.variant },
      sets: {
        above: createMaterialSet({ plane: above, scan, lowPower }),
        below: createMaterialSet({ plane: below, scan, lowPower }),
      },
    };
  }, [film, lowPower]);

  useEffect(() => {
    gl.localClippingEnabled = true;
    gl.toneMapping = THREE.NeutralToneMapping;
    gl.toneMappingExposure = 1.12;
    gl.transmissionResolutionScale = 0.7;
    return () => SIDES.forEach((side) => disposeMaterialSet(rig.sets[side]));
  }, [gl, rig]);

  useEffect(() => {
    if (allLooks) compileMaterials(gl, camera, scene, SIDES.map((side) => rig.sets[side]));
  }, [allLooks, gl, camera, scene, rig]);

  const target = useMemo(() => new THREE.Vector3(), []);
  const smooth = useRef({ yaw: film.yaw, px: 0, py: 0 });

  useFrame((_, delta) => {
    // 1. Which looks are on screen, and how far the plane has travelled between them.
    const index = Math.floor(film.look + 1e-4);
    const lookFraction = film.look - index;
    let a = index;
    let b = null;
    let sweep = 0;
    let aboveVariant = film.variant;

    if (film.intro < 1) {
      a = null;
      b = 0;
      sweep = film.intro;
    } else if (lookFraction > 1e-3 && index < LOOKS.length - 1) {
      b = index + 1;
      sweep = lookFraction;
    } else if (film.swap < 1 && LOOKS[index].tray === "variant") {
      b = index;
      aboveVariant = film.previousVariant;
      sweep = film.swap;
    }

    LOOKS.forEach((_, i) => {
      if (slots.current.above[i]) slots.current.above[i].visible = i === a;
      if (slots.current.below[i]) slots.current.below[i].visible = i === b;
    });
    rig.variants.above = aboveVariant;
    rig.variants.below = film.variant;

    scene.backgroundIntensity = film.house;

    // 2. The plane. With no split in progress it moves far away and clips nothing.
    const splitting = b !== null;
    const y = -SWEEP_MARGIN + sweep * (DEVICE_HEIGHT + SWEEP_MARGIN * 2);
    rig.above.constant = splitting ? -y : 1000;
    rig.below.constant = splitting ? y : 1000;
    const glow = splitting ? Math.sin(Math.min(1, sweep * 1.04) * Math.PI) ** 0.5 : 0;
    rig.scan.uScanY.value = y;
    rig.scan.uScanOn.value = glow;
    if (planeMesh.current) {
      planeMesh.current.visible = glow > 0.01;
      planeMesh.current.position.y = y;
      planeMesh.current.material.uniforms.uOn.value = glow;
    }

    // 3. The camera, fitted so the device stays in frame on a narrow screen.
    const aspect = size.width / size.height;
    const portrait = aspect < 1.05;
    const fit = (2.7 + film.open * 0.9) / (2 * Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV / 2)) * aspect);
    const dist = Math.max(film.dist, fit);
    const k = 1 - Math.exp(-delta * 5);
    smooth.current.px += (film.pointerX - smooth.current.px) * k;
    smooth.current.py += (film.pointerY - smooth.current.py) * k;
    const pitch = film.pitch + smooth.current.py * 0.04;
    const targetX = portrait ? 0 : film.x * (aspect < 1.5 ? aspect / 1.5 : 1);
    const targetY = portrait ? film.y - dist * 0.09 : film.y;
    target.set(targetX, targetY, 0);
    camera.position.set(targetX + smooth.current.px * 0.16, targetY + Math.sin(pitch) * dist, Math.cos(pitch) * dist);
    camera.lookAt(target);

    // 4. The device.
    if (device.current) {
      device.current.rotation.y = film.yaw + film.drift + film.userYaw + smooth.current.px * 0.08;
      const rise = THREE.MathUtils.smoothstep(film.intro, 0, 1);
      device.current.scale.setScalar(0.97 + rise * 0.03);
    }
  });

  return (
    <>
      <Backdrop />
      <Diamonds />
      <Studio />
      <Floor film={film} />
      <group ref={device}>
        {SIDES.map((side) =>
          LOOKS.map((look, i) =>
            i === 0 || allLooks ? (
              <group key={`${side}-${i}`} ref={(el) => (slots.current[side][i] = el)} visible={false}>
                <Suspense fallback={null}>
                  <ApplianceLook look={look} side={side} rig={rig} film={film} />
                </Suspense>
              </group>
            ) : null
          )
        )}
        <Suspense fallback={null}>
          <AnatomyLabels film={film} />
        </Suspense>
      </group>
      <ScanPlane meshRef={planeMesh} />
    </>
  );
}

/* Reports once the first model is really on the GPU, then starts the entrance. */
function Loaded({ onLoaded }) {
  useAppliance(LOOKS[0].device);
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    let live = true;
    const done = () => live && onLoaded();
    gl.compileAsync(scene, camera).then(done, done);
    return () => {
      live = false;
    };
  }, [gl, scene, camera, onLoaded]);
  return null;
}

export default function FilmStage({ film, lowPower, running, onLoaded, onLost }) {
  const [dpr, setDpr] = useState(lowPower ? 1.25 : 1.75);
  const [allLooks, setAllLooks] = useState(false);
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current?.querySelector("canvas");
    if (!canvas) return undefined;
    const lost = (event) => {
      event.preventDefault();
      onLost?.();
    };
    canvas.addEventListener("webglcontextlost", lost);
    return () => canvas.removeEventListener("webglcontextlost", lost);
  }, [onLost]);

  const handleLoaded = useMemo(
    () => () => {
      onLoaded?.();
      gsap.to(film, { intro: 1, duration: 2.1, ease: "power2.inOut", delay: 0.15 });
      const later = window.requestIdleCallback ?? ((fn) => setTimeout(fn, 800));
      later(() => setAllLooks(true)); // the rest of the film's models, once the first is up
    },
    [film, onLoaded]
  );

  return (
    <div ref={canvasRef} className="absolute inset-0">
      <Canvas
        dpr={dpr}
        frameloop={running ? "always" : "never"}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        camera={{ fov: CAMERA_FOV, near: 0.1, far: 60, position: [0, 1, 7] }}
      >
        <PerformanceMonitor onDecline={() => setDpr(1)} />
        <Suspense fallback={null}>
          <Film film={film} lowPower={lowPower} allLooks={allLooks} />
          <Loaded onLoaded={handleLoaded} />
        </Suspense>
      </Canvas>
    </div>
  );
}
