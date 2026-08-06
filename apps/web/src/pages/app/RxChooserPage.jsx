import { Link } from "react-router-dom";
import { ArrowLeft, FileText, ArrowRight } from "lucide-react";
import { FORM_LIST } from "../../data/forms/index.js";
import { ROUTES } from "../../config/routes.js";

/* Short descriptions keyed by form slug for the chooser cards. */
const DESCRIPTIONS = {
  digital:
    "The full digital prescription for Diamond-fabricated orthotic and dental devices. Pick a device, configure it, and upload scans.",
};

export function RxChooserPage() {
  return (
    <div className="min-h-screen bg-surface-50">
      <div className="border-b border-surface-300/30 bg-white px-6 py-4 flex items-center gap-3">
        <Link to="/" className="text-navy/40 hover:text-navy transition-colors">
          <ArrowLeft size={18} />
        </Link>
        <span className="font-mono text-xs text-navy/30 uppercase tracking-widest">
          Diamond Labs · Rx Forms
        </span>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-10 pb-20">
        <div className="mb-8">
          <h1 className="font-heading font-bold text-3xl text-navy tracking-tight">
            Choose an Rx Form
          </h1>
          <p className="mt-2 text-sm text-navy/40 max-w-xl">
            Select the prescription form for your case. Each form is HIPAA-compliant
            and pre-fills your account information.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {FORM_LIST.map((form) => (
            <Link
              key={form.slug}
              to={form.route}
              className="group flex flex-col p-6 rounded-[2rem] bg-white border border-surface-300/50 shadow-sm hover:shadow-xl hover:shadow-navy/5 hover:border-brand-500/30 transition-all duration-300"
            >
              <div className="w-12 h-12 rounded-2xl bg-brand-500/10 flex items-center justify-center mb-5 group-hover:bg-brand-500/15 transition-colors">
                <FileText size={22} className="text-brand-500" />
              </div>
              <h2 className="font-heading font-bold text-lg text-navy tracking-tight">
                {form.title}
              </h2>
              <p className="mt-2 flex-1 text-sm text-navy/45 leading-relaxed">
                {DESCRIPTIONS[form.slug] || ""}
              </p>
              <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-500 group-hover:gap-2.5 transition-all">
                Open form <ArrowRight size={15} />
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
