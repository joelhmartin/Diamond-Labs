import { Download, FileText } from "lucide-react";
import { PageHero } from "../../components/marketing/PageHero";
import { Reveal } from "../../components/marketing/Reveal";

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
      <PageHero title="Downloads" intro="Instructions, brochures and publications from Diamond Orthotic Laboratory." />

      <Reveal className="section-pad py-16 md:py-20">
        <div className="max-w-6xl mx-auto">
        <ul className="max-w-3xl divide-y divide-navy/15 border-y border-navy/15">
          {downloads.map((item) => (
            <li key={item.filename}>
              <a
                href={`/downloads/${item.filename}`}
                download
                className="group flex items-center gap-4 py-5 hover:bg-surface-100 transition-colors"
              >
                <FileText size={20} className="flex-shrink-0 text-brand-700" />
                <span className="flex-1 min-w-0">
                  <span className="block font-semibold text-navy">{item.title}</span>
                  <span className="block mt-0.5 text-sm text-navy/70">{item.description}</span>
                </span>
                <span className="flex-shrink-0 font-mono text-xs text-navy/70">PDF, {item.year}</span>
                <Download size={16} className="flex-shrink-0 text-brand-700 group-hover:translate-y-0.5 transition-transform" />
              </a>
            </li>
          ))}
        </ul>
        </div>
      </Reveal>
    </div>
  );
}
