import { SectionHeading } from "./SectionHeading";
import { Reveal } from "./Reveal";

/* A condition's warning signs: heading, intro and a photo of someone living with it,
   held beside a grid of icon cards.
     symptoms — [{ Icon, text }]
     photo    — { src, alt }: a landscape photo of a person, cropped to fill its frame */
export function SymptomsSection({ title, intro, photo, symptoms, tone = "bg-surface-100" }) {
  return (
    <Reveal className={`section-pad py-20 md:py-24 ${tone}`}>
      <div className="max-w-6xl mx-auto grid lg:grid-cols-[1fr_1.4fr] gap-10 lg:gap-14 items-start">
        <div className="lg:sticky lg:top-28">
          <SectionHeading title={title} intro={intro} />
          <img
            src={photo.src}
            alt={photo.alt}
            loading="lazy"
            className="mt-8 w-full aspect-[4/3] object-cover rounded-[2rem] border border-surface-300/60 shadow-sm"
          />
        </div>
        <ul className="grid sm:grid-cols-2 gap-4">
          {symptoms.map(({ Icon, text }) => (
            <li
              key={text}
              className="flex items-center gap-4 rounded-[1.75rem] bg-white border border-surface-300/60 shadow-sm p-5 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-navy/10 transition-all duration-300"
            >
              <span className="flex-shrink-0 grid place-items-center w-12 h-12 rounded-2xl bg-brand-100 text-brand-700">
                <Icon size={22} aria-hidden="true" />
              </span>
              <span className="text-navy leading-snug">{text}</span>
            </li>
          ))}
        </ul>
      </div>
    </Reveal>
  );
}
