import { useEffect, useRef, useState } from "react";
import { Eraser, Pencil } from "lucide-react";

/**
 * Canvas signature capture. Emits a base64 PNG via onChange(dataUrl)
 * whenever a stroke completes. Call clear() to wipe.
 */
export function Signature({ value, onChange, label = "Doctor signature", required }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const lastPoint = useRef(null);
  const [hasInk, setHasInk] = useState(Boolean(value));

  function getCtx() {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    return canvas.getContext("2d");
  }

  function sizeCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    const ctx = canvas.getContext("2d");
    ctx.scale(ratio, ratio);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#0B1A2E";
  }

  useEffect(() => {
    sizeCanvas();
    const onResize = () => sizeCanvas();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pointFromEvent(e) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches?.[0]?.clientX ?? e.clientX;
    const clientY = e.touches?.[0]?.clientY ?? e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function start(e) {
    e.preventDefault();
    drawing.current = true;
    lastPoint.current = pointFromEvent(e);
  }

  function move(e) {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = getCtx();
    if (!ctx) return;
    const p = pointFromEvent(e);
    ctx.beginPath();
    ctx.moveTo(lastPoint.current.x, lastPoint.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastPoint.current = p;
    if (!hasInk) setHasInk(true);
  }

  function end() {
    if (!drawing.current) return;
    drawing.current = false;
    lastPoint.current = null;
    const canvas = canvasRef.current;
    if (canvas && onChange) {
      onChange(canvas.toDataURL("image/png"));
    }
  }

  function clear() {
    const ctx = getCtx();
    const canvas = canvasRef.current;
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
    if (onChange) onChange("");
  }

  return (
    <div>
      <label className="block text-xs font-semibold text-navy/40 uppercase tracking-wider mb-2">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      <div className="relative rounded-2xl bg-surface-50 border border-surface-300/50 overflow-hidden">
        <canvas
          ref={canvasRef}
          className="block w-full h-40 md:h-48 touch-none cursor-crosshair"
          onMouseDown={start}
          onMouseMove={move}
          onMouseUp={end}
          onMouseLeave={end}
          onTouchStart={start}
          onTouchMove={move}
          onTouchEnd={end}
        />
        {!hasInk && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="flex items-center gap-2 text-navy/25 text-sm">
              <Pencil size={14} />
              <span>Sign here</span>
            </div>
          </div>
        )}
        <div className="absolute bottom-2 left-0 right-0 flex items-center justify-between px-3">
          <span className="text-[10px] font-mono text-navy/20">X</span>
          {hasInk && (
            <button
              type="button"
              onClick={clear}
              className="flex items-center gap-1 text-[10px] font-mono text-navy/40 hover:text-accent-500 transition-colors px-2 py-1 rounded-full bg-white/60 backdrop-blur-sm"
            >
              <Eraser size={10} />
              Clear
            </button>
          )}
        </div>
      </div>
      <p className="mt-2 text-[11px] text-navy/30 leading-snug">
        By signing, you authorize Diamond Orthotic Laboratory to fabricate
        the prescribed device per the specifications above.
      </p>
    </div>
  );
}
