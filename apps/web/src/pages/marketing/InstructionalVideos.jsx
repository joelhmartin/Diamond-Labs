import { PageHero } from "../../components/marketing/PageHero";
import { Reveal } from "../../components/marketing/Reveal";

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
        intro="Training and technique videos to help you get the best results with Diamond Orthotic Laboratory products."
      />

      <Reveal className="section-pad py-16 md:py-20">
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-8">
          {VIDEOS.map((video) => (
            <div key={video.id}>
              <div
                className="relative w-full rounded-[2rem] overflow-hidden bg-navy"
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
              <h2 className="mt-3 px-2 font-heading font-semibold text-base text-navy">{video.title}</h2>
            </div>
          ))}
        </div>
      </Reveal>
    </div>
  );
}
