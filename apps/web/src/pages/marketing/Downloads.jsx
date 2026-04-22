import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Download, FileText, ArrowLeft } from "lucide-react";

const downloads = [
  {
    title: "Digital Rx Instructions",
    description: "Step-by-step guide for submitting digital prescriptions to Diamond Orthotic Laboratory.",
    filename: "Digital-Rx-Instructions-2022.pdf",
    year: "2022",
    category: "Instructions",
  },
  {
    title: "Diamond Lab Brochure",
    description: "Overview of Diamond Orthotic Laboratory services, products, and capabilities.",
    filename: "Diamond-Lab-Brochure-2020.pdf",
    year: "2020",
    category: "Brochure",
  },
  {
    title: "Newsletter — March 2026",
    description: "Latest updates, product announcements, and news from Diamond Orthotic Laboratory.",
    filename: "Newsletter-March-2026.pdf",
    year: "2026",
    category: "Newsletter",
  },
];

export function DownloadsPage() {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <div>
      {/* Hero */}
      <section className="relative bg-gradient-to-b from-navy via-brand-900 to-surface-100 pt-32 pb-28">
        <div className="section-pad text-center max-w-2xl mx-auto">
          <span className="font-mono text-xs text-white/30 uppercase tracking-widest">
            Resources
          </span>
          <h1 className="mt-4 font-heading font-bold text-3xl md:text-5xl text-white tracking-tight">
            Downloads
          </h1>
          <p className="mt-4 text-white/40 text-sm md:text-base max-w-md mx-auto leading-relaxed">
            Forms, brochures, and publications from Diamond Orthotic Laboratory.
          </p>
        </div>
      </section>

      {/* Downloads Grid */}
      <section className="relative z-10 section-pad -mt-8 pb-20">
        <div className="max-w-3xl mx-auto space-y-4">
          {downloads.map((item) => (
            <a
              key={item.filename}
              href={`/downloads/${item.filename}`}
              download
              className="group flex items-center gap-5 bg-white card-radius p-6 border border-surface-300/50 shadow-lg shadow-navy/5 hover:border-brand-500/30 hover:shadow-xl transition-all"
            >
              <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-brand-50 border border-brand-100 flex items-center justify-center group-hover:bg-brand-100 transition-colors">
                <FileText size={20} className="text-brand-600" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-navy text-sm md:text-base">
                  {item.title}
                </h3>
                <p className="text-navy/40 text-xs md:text-sm mt-0.5 line-clamp-1">
                  {item.description}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="inline-block px-2 py-0.5 rounded-full bg-surface-100 text-navy/30 text-[10px] font-mono uppercase tracking-wider">
                    {item.category}
                  </span>
                  <span className="text-navy/20 text-[10px] font-mono">{item.year}</span>
                </div>
              </div>
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-accent-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <Download size={16} />
              </div>
            </a>
          ))}
        </div>

        <div className="max-w-3xl mx-auto mt-10 text-center">
          <Link
            to="/"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-medium border border-surface-300/50 text-navy/60 hover:text-navy hover:border-brand-500/30 transition-all"
          >
            <ArrowLeft size={14} /> Back to Home
          </Link>
        </div>
      </section>
    </div>
  );
}
