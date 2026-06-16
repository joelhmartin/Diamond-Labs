import { useEffect, useRef, useState } from "react";
import { Eraser, Pencil, Trash2 } from "lucide-react";

/**
 * "Diamond ORTHO Artboard" — draw-your-appliance canvas (replaces the JotForm
 * artboard widget). Two stacked canvases: a static dental-arch guide underneath
 * and a transparent drawing layer on top, so the eraser removes strokes without
 * wiping the guide. Emits a flattened PNG data URL via onChange(dataUrl) on each
 * stroke end (and "" when cleared). If `value` (a prior PNG data URL) is given,
 * it is restored onto the drawing layer on mount.
 *
 * The exported PNG is the guide + strokes composited, so the lab sees the sketch
 * in context.
 */
const W = 760;
const H = 460;
const PEN_COLORS = ["#0B1A2E", "#dc2626", "#1393C9", "#16a34a"];
const PEN_SIZES = [2, 4, 8];

export function Artboard({ value, onChange }) {
  const guideRef = useRef(null); // static arch guide
  const drawRef = useRef(null); // transparent strokes layer
  const drawing = useRef(false);
  const last = useRef(null);
  // Ref mirrors hasInk for synchronous reads in end() — React state may not have
  // committed between move() (which sets it) and the mouseup that fires end(),
  // which would otherwise drop the first stroke's exported PNG.
  const inkRef = useRef(Boolean(value));
  const [color, setColor] = useState(PEN_COLORS[0]);
  const [size, setSize] = useState(PEN_SIZES[1]);
  const [eraser, setEraser] = useState(false);
  const [hasInk, setHasInk] = useState(Boolean(value));

  // Draw the dental-arch guide once.
  useEffect(() => {
    const ctx = guideRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = "#9fb4c4";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    // Upper arch (top) + lower arch (bottom): simple U-shaped curves.
    const arch = (cy, flip) => {
      ctx.beginPath();
      const top = flip ? cy + 150 : cy - 150;
      ctx.moveTo(W * 0.2, cy);
      ctx.bezierCurveTo(W * 0.2, top, W * 0.8, top, W * 0.8, cy);
      ctx.stroke();
    };
    arch(H * 0.33, false); // upper
    arch(H * 0.67, true); // lower
    ctx.setLineDash([]);
    ctx.fillStyle = "#9fb4c4";
    ctx.font = "11px monospace";
    ctx.fillText("UPPER", W * 0.5 - 18, H * 0.33 - 158);
    ctx.fillText("LOWER", W * 0.5 - 18, H * 0.67 + 168);
  }, []);

  // Restore a prior drawing onto the strokes layer.
  useEffect(() => {
    if (!value) return;
    const ctx = drawRef.current?.getContext("2d");
    if (!ctx) return;
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0, W, H);
    img.src = value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pointFromEvent(e) {
    const rect = drawRef.current.getBoundingClientRect();
    const clientX = e.touches?.[0]?.clientX ?? e.clientX;
    const clientY = e.touches?.[0]?.clientY ?? e.clientY;
    // Map CSS pixels → canvas coordinate space (canvas is W×H, displayed responsive).
    return {
      x: ((clientX - rect.left) / rect.width) * W,
      y: ((clientY - rect.top) / rect.height) * H,
    };
  }

  function start(e) {
    e.preventDefault();
    drawing.current = true;
    last.current = pointFromEvent(e);
  }

  function move(e) {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = drawRef.current?.getContext("2d");
    if (!ctx) return;
    const p = pointFromEvent(e);
    ctx.globalCompositeOperation = eraser ? "destination-out" : "source-over";
    ctx.strokeStyle = color;
    ctx.lineWidth = eraser ? size * 4 : size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    if (!inkRef.current) {
      inkRef.current = true;
      setHasInk(true);
    }
  }

  function exportPng() {
    // Flatten guide + strokes onto a temp canvas.
    const tmp = document.createElement("canvas");
    tmp.width = W;
    tmp.height = H;
    const tctx = tmp.getContext("2d");
    tctx.fillStyle = "#ffffff";
    tctx.fillRect(0, 0, W, H);
    if (guideRef.current) tctx.drawImage(guideRef.current, 0, 0);
    if (drawRef.current) tctx.drawImage(drawRef.current, 0, 0);
    return tmp.toDataURL("image/png");
  }

  function end() {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    onChange?.(inkRef.current ? exportPng() : "");
  }

  function clear() {
    const ctx = drawRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    inkRef.current = false;
    setHasInk(false);
    onChange?.("");
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {PEN_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => { setColor(c); setEraser(false); }}
            className={`w-6 h-6 rounded-full border-2 transition-all ${
              color === c && !eraser ? "border-navy scale-110" : "border-surface-300/60"
            }`}
            style={{ backgroundColor: c }}
            aria-label={`Pen color ${c}`}
          />
        ))}
        <span className="mx-1 w-px h-5 bg-surface-300/60" />
        {PEN_SIZES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSize(s)}
            className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${
              size === s ? "bg-brand-500 text-white" : "bg-surface-50 text-navy/50 border border-surface-300/50"
            }`}
            aria-label={`Pen size ${s}`}
          >
            <span className="rounded-full bg-current block" style={{ width: s + 1, height: s + 1 }} />
          </button>
        ))}
        <span className="mx-1 w-px h-5 bg-surface-300/60" />
        <button
          type="button"
          onClick={() => setEraser((v) => !v)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
            eraser ? "bg-brand-500 text-white" : "bg-surface-50 text-navy/60 border border-surface-300/50"
          }`}
        >
          <Eraser size={12} /> Eraser
        </button>
        <button
          type="button"
          onClick={clear}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-surface-50 text-navy/60 border border-surface-300/50 hover:text-red-500 hover:border-red-200 transition-all"
        >
          <Trash2 size={12} /> Clear
        </button>
      </div>

      {/* Canvas stack */}
      <div className="relative rounded-2xl bg-white border border-surface-300/50 overflow-hidden" style={{ aspectRatio: `${W} / ${H}` }}>
        <canvas ref={guideRef} width={W} height={H} className="absolute inset-0 w-full h-full pointer-events-none" />
        <canvas
          ref={drawRef}
          width={W}
          height={H}
          className="absolute inset-0 w-full h-full touch-none cursor-crosshair"
          onMouseDown={start}
          onMouseMove={move}
          onMouseUp={end}
          onMouseLeave={end}
          onTouchStart={start}
          onTouchMove={move}
          onTouchEnd={end}
        />
        {!hasInk && (
          <div className="pointer-events-none absolute inset-0 flex items-end justify-center pb-3">
            <div className="flex items-center gap-2 text-navy/25 text-xs">
              <Pencil size={12} />
              <span>Draw your appliance design over the arches</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
