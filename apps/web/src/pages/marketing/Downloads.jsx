import { Download, FileText } from "lucide-react";
import { PageHero } from "../../components/marketing/PageHero";
import { Reveal } from "../../components/marketing/Reveal";
import { CtaBand } from "../../components/marketing/CtaBand";

const downloads = [
  {
    title: "Digital Rx Instructions",
    description: "Step-by-step guide for submitting digital prescriptions to Diamond Orthotic Laboratory.",
    filename: "Digital-Rx-Instructions-2022.pdf",
    year: "2022",
  },
  {
    title: "Diamond Lab Brochure",
    description: "Overview of Diamond Orthotic Laboratory services, products, and capabilities.",
    filename: "Diamond-Lab-Brochure-2020.pdf",
    year: "2020",
  },
  {
    title: "Newsletter, March 2026",
    description: "Latest updates, product announcements, and news from Diamond Orthotic Laboratory.",
    filename: "Newsletter-March-2026.pdf",
    year: "2026",
  },
];

export function DownloadsPage() {
  return (
    <div>
      <PageHero
        title="Downloads"
        titleAccent="to keep on hand."
        intro="Instructions, brochures and publications from Diamond Orthotic Laboratory."
        product="/images/ddso-post-stacked.webp"
        productAlt="Two DDSO sleep appliances stacked"
      />

      <Reveal className="section-pad py-16 md:py-24">
        <div className="max-w-6xl mx-auto">
          <ul className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {downloads.map((item) => (
              <li key={item.filename}>
                <a
                  href={`/downloads/${item.filename}`}
                  download
                  className="group flex flex-col h-full rounded-[2rem] bg-white border border-surface-300/60 shadow-sm p-7 hover:shadow-xl hover:shadow-navy/10 hover:-translate-y-1 transition-all duration-300"
                >
                  <span className="relative grid place-items-center w-20 h-24 rounded-2xl bg-navy text-on-dark shadow-lg shadow-navy/20">
                    <FileText size={30} className="text-brand-400" aria-hidden="true" />
                    <span className="absolute bottom-2 font-mono text-[11px] font-semibold tracking-widest">PDF</span>
                  </span>
                  <span className="mt-6 font-heading font-bold text-xl tracking-tight text-navy">{item.title}</span>
                  <span className="mt-2 text-navy/70 leading-relaxed">{item.description}</span>
                  <span className="mt-auto pt-6 flex items-center justify-between gap-3">
                    <span className="font-mono text-xs text-navy/70">PDF, {item.year}</span>
                    <span className="inline-flex items-center gap-2 font-semibold text-brand-700">
                      Download
                      <Download size={16} aria-hidden="true" className="group-hover:translate-y-0.5 transition-transform" />
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </Reveal>

      <CtaBand
        title="Need more than a PDF?"
        intro="See how to send a case, or watch the technique videos."
        primary={{ to: "/resources/rx-instructions", label: "Rx instructions" }}
        secondary={{ to: "/resources/videos", label: "Instructional videos" }}
        product="/images/onp-bioflex-new.webp"
        productAlt="An Olmos Neuromuscular Positioner appliance"
      />
    </div>
  );
}
