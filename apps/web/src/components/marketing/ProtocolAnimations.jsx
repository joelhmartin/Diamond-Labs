/* Looping line animations for the Home process cards. */
import { useEffect, useRef } from "react";
import gsap from "gsap";
import { prefersReducedMotion } from "../../lib/reducedMotion";

export function RotatingGeometry() {
  const ref = useRef(null);
  useEffect(() => {
    if (prefersReducedMotion()) return undefined;
    const ctx = gsap.context(() => {
      gsap.to("[data-rotate]", {
        rotation: 360,
        duration: 20,
        repeat: -1,
        ease: "none",
        transformOrigin: "center center",
      });
      gsap.to("[data-rotate-reverse]", {
        rotation: -360,
        duration: 30,
        repeat: -1,
        ease: "none",
        transformOrigin: "center center",
      });
    }, ref);
    return () => ctx.revert();
  }, []);

  return (
    <svg
      ref={ref}
      viewBox="0 0 200 200"
      className="w-64 h-64 md:w-80 md:h-80"
    >
      <g data-rotate>
        <circle
          cx="100"
          cy="100"
          r="60"
          fill="none"
          stroke="rgb(var(--brand-600))"
          strokeWidth="1"
          opacity="0.65"
        />
        <circle
          cx="100"
          cy="100"
          r="45"
          fill="none"
          stroke="rgb(var(--brand-600))"
          strokeWidth="1"
          opacity="0.5"
        />
        {[0, 60, 120, 180, 240, 300].map((angle) => (
          <circle
            key={angle}
            cx={100 + 60 * Math.cos((angle * Math.PI) / 180)}
            cy={100 + 60 * Math.sin((angle * Math.PI) / 180)}
            r="3"
            fill="rgb(var(--brand-600))"
            opacity="0.9"
          />
        ))}
      </g>
      <g data-rotate-reverse>
        <rect
          x="65"
          y="65"
          width="70"
          height="70"
          fill="none"
          stroke="rgb(var(--brand-600))"
          strokeWidth="1"
          opacity="0.5"
          rx="4"
        />
        <rect
          x="78"
          y="78"
          width="44"
          height="44"
          fill="none"
          stroke="rgb(var(--brand-600))"
          strokeWidth="1"
          opacity="0.5"
          rx="4"
        />
      </g>
      <circle cx="100" cy="100" r="4" fill="rgb(var(--brand-600))" opacity="1" />
    </svg>
  );
}

export function ScanningGrid() {
  const ref = useRef(null);
  useEffect(() => {
    if (prefersReducedMotion()) return undefined;
    const ctx = gsap.context(() => {
      gsap.to("[data-scan-line]", {
        y: 160,
        duration: 2.5,
        repeat: -1,
        ease: "power1.inOut",
        yoyo: true,
      });
    }, ref);
    return () => ctx.revert();
  }, []);

  const dots = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      dots.push(
        <circle
          key={`${row}-${col}`}
          cx={40 + col * 17}
          cy={20 + row * 20}
          r="2"
          fill="rgb(var(--brand-600))"
          opacity="0.65"
        />
      );
    }
  }

  return (
    <svg
      ref={ref}
      viewBox="0 0 200 200"
      className="w-64 h-64 md:w-80 md:h-80"
    >
      {dots}
      <line
        data-scan-line
        x1="30"
        y1="20"
        x2="170"
        y2="20"
        stroke="rgb(var(--brand-600))"
        strokeWidth="1"
        opacity="0.9"
      />
      <rect
        data-scan-line
        x="30"
        y="12"
        width="140"
        height="16"
        fill="url(#scanGradient)"
      />
      <defs>
        <linearGradient id="scanGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(var(--brand-600))" stopOpacity="0" />
          <stop offset="50%" stopColor="rgb(var(--brand-600))" stopOpacity="0.1" />
          <stop offset="100%" stopColor="rgb(var(--brand-600))" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function PulsingWaveform() {
  const ref = useRef(null);
  useEffect(() => {
    if (prefersReducedMotion()) return undefined;
    const ctx = gsap.context(() => {
      gsap.to("[data-waveform]", {
        strokeDashoffset: -400,
        duration: 3,
        repeat: -1,
        ease: "none",
      });
    }, ref);
    return () => ctx.revert();
  }, []);

  return (
    <svg
      ref={ref}
      viewBox="0 0 200 100"
      className="w-72 h-36 md:w-96 md:h-48"
    >
      <path
        data-waveform
        d="M0,50 L20,50 L25,50 L30,20 L35,80 L40,30 L45,70 L50,45 L55,55 L60,50 L80,50 L85,50 L90,15 L95,85 L100,25 L105,75 L110,40 L115,60 L120,50 L140,50 L145,50 L150,20 L155,80 L160,30 L165,70 L170,45 L175,55 L180,50 L200,50"
        fill="none"
        stroke="rgb(var(--brand-600))"
        strokeWidth="2"
        strokeDasharray="200"
        strokeDashoffset="0"
        opacity="0.9"
      />
      <path
        d="M0,50 L200,50"
        fill="none"
        stroke="rgb(var(--brand-600))"
        strokeWidth="0.6"
        opacity="0.5"
      />
    </svg>
  );
}
