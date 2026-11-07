import { useEffect } from "react";
import { ApplianceFilm } from "../../components/marketing/film/ApplianceFilm.jsx";
import { CtaBand } from "../../components/marketing/CtaBand.jsx";
import { StatRow } from "../../components/marketing/StatRow.jsx";
import { Reveal } from "../../components/marketing/Reveal.jsx";
import { BackToTop } from "../../components/marketing/BackToTop.jsx";
import { Features } from "./Home.jsx";

/* A preview of Home built around the lab's real 3D appliances. It sits on its own
   route, out of search, so it can be compared with Home before any decision to swap. */

const STATS = [
  { value: "19", label: "Lab team members" },
  { value: "<2wk", label: "Turnaround" },
  { value: "FDA", label: "510(k) sleep appliances" },
  { value: "3", label: "Countries with certified labs" },
];

function useNoIndex() {
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex";
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);
}

function Proof() {
  return (
    <section className="section-pad pt-24 md:pt-28">
      <div className="max-w-6xl mx-auto">
        <Reveal>
          <h2 className="font-drama italic text-4xl sm:text-5xl md:text-6xl text-navy leading-[1.1] tracking-tight">
            <span className="text-brand-700">Protocol-driven</span> precision for every case.
          </h2>
          <p className="mt-6 max-w-xl text-navy/70 md:text-lg leading-relaxed">
            Every orthotic we fabricate follows a documented clinical protocol and is quality-checked before it leaves our lab.
          </p>
          <div className="mt-12 pt-10 border-t border-navy/10">
            <StatRow stats={STATS} />
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export function HomeCinematicPage() {
  useNoIndex();
  return (
    <>
      <BackToTop />
      <ApplianceFilm />
      <Proof />
      <Features />
      <CtaBand
        title="Get the best for your"
        titleAccent="patients."
        intro={
          <>
            Whether you&apos;re treating TMJ disorders, sleep breathing conditions, or both — we&apos;re the lab that understands your protocol.
          </>
        }
        primary={{ label: "Contact Our Lab", to: "/contact" }}
        secondary={{ label: "View All Products", to: "/products" }}
        product="/images/cta-patients.webp"
        productAlt="Three smiling people, each holding a custom oral appliance"
        productFlush
      />
    </>
  );
}
