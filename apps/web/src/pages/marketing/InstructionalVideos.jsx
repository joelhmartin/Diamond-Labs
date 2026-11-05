import { PlayCircle } from "lucide-react";
import { PageHero } from "../../components/marketing/PageHero";
import { Reveal } from "../../components/marketing/Reveal";
import { CtaBand } from "../../components/marketing/CtaBand";

const VIDEOS = [
  {
    id: "1169988766",
    title: "Tips on Scanning Difficult Cases",
    aspect: "50%", // slightly different aspect for this one
  },
  {
    id: "1169987842",
    title: "Delivery of OD-PMT and ON-P (PMT)",
  },
  {
    id: "1169985466",
    title: "Phonetic Bite",
  },
  {
    id: "1169985993",
    title: "Minimum Occlusal Space Requirements",
  },
  {
    id: "1169985879",
    title: "Phonetic Bite — Anterior",
  },
  {
    id: "1169986561",
    title: "How to Adjust Appliances",
  },
  {
    id: "1169981727",
    title: "Shirazi Hybrid",
  },
];

export function InstructionalVideosPage() {
  return (
    <div>
      <PageHero
        title="Instructional videos"
        titleAccent="for better results."
        intro="Training and technique videos to help you get the best results with Diamond Orthotic Laboratory products."
        product="/images/od-pmt.webp"
        productAlt="An OD-PMT appliance"
      />

      <Reveal className="section-pad py-16 md:py-24">
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
          {VIDEOS.map((video) => (
            <div
              key={video.id}
              className="rounded-[2rem] bg-white border border-surface-300/60 shadow-sm p-3 md:p-4 hover:shadow-xl hover:shadow-navy/10 transition-shadow duration-300"
            >
              <div
                className="relative w-full rounded-[1.5rem] overflow-hidden bg-navy"
                style={{ paddingTop: video.aspect || "56.25%" }}
              >
                <iframe
                  src={`https://player.vimeo.com/video/${video.id}?title=0&byline=0&portrait=0&badge=0&autopause=0&player_id=0&app_id=58479`}
                  allow="autoplay; fullscreen; picture-in-picture; clipboard-write; encrypted-media; web-share"
                  referrerPolicy="strict-origin-when-cross-origin"
                  className="absolute inset-0 w-full h-full"
                  style={{ border: "none" }}
                  title={video.title}
                  loading="lazy"
                />
              </div>
              <div className="flex items-center gap-4 px-3 py-4">
                <span className="flex-shrink-0 grid place-items-center w-10 h-10 rounded-xl bg-brand-100 text-brand-700">
                  <PlayCircle size={20} aria-hidden="true" />
                </span>
                <h2 className="font-heading font-bold text-lg tracking-tight text-navy">{video.title}</h2>
              </div>
            </div>
          ))}
        </div>
      </Reveal>

      <CtaBand
        title="Questions about a technique?"
        intro="Call the lab, or reach us through the contact form."
        primary={{ href: "tel:+16197246400", label: "Call 619.724.6400" }}
        secondary={{ to: "/contact", label: "Contact form" }}
        product="/images/ddso-nylon-bands.webp"
        productAlt="A DDSO sleep appliance with nylon bands"
      />
    </div>
  );
}
