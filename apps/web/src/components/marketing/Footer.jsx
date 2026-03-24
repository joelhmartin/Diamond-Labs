import { Link } from "react-router-dom";
import { ArrowUpRight, Facebook, Instagram, Linkedin, Youtube } from "lucide-react";

const SOCIALS = [
  { icon: Facebook, href: "https://facebook.com/diamondorthotic", label: "Facebook" },
  { icon: Instagram, href: "https://instagram.com/diamondorthotic", label: "Instagram" },
  { icon: Linkedin, href: "https://linkedin.com/company/diamond-orthotic-laboratory", label: "LinkedIn" },
  { icon: Youtube, href: "https://youtube.com/@diamondorthotic", label: "YouTube" },
];

const FOOTER_NAV = {
  Products: [
    { label: "Olmos Series", to: "/products" },
    { label: "DDSO Sleep Orthotic", to: "/products" },
    { label: "TMD Orthotics", to: "/products" },
    { label: "Materials", to: "/products" },
  ],
  Company: [
    { label: "About Us", to: "/about" },
    { label: "Our Process", to: "/about" },
    { label: "Contact", to: "/contact" },
  ],
  Resources: [
    { label: "For Dentists", to: "/contact" },
    { label: "Case Submission", to: "/contact" },
    { label: "Digital Workflow", to: "/about" },
  ],
};

export function Footer() {
  return (
    <footer className="relative bg-navy rounded-t-[3rem] md:rounded-t-[4rem] mt-24">
      <div className="section-pad pt-16 pb-8 md:pt-24 md:pb-10">
        {/* Top section */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-12 md:gap-8 pb-12 border-b border-white/10">
          {/* Brand block */}
          <div className="md:col-span-4">
            <h3 className="font-heading font-bold text-white text-xl tracking-tight">
              Diamond Orthotic Laboratory
            </h3>
            <p className="mt-3 text-white/50 text-sm leading-relaxed max-w-xs">
              The premier Olmos-Method orthotic laboratory. Digital-first
              precision for TMJ and sleep breathing disorders.
            </p>
            {/* Social links */}
            <div className="mt-6 flex items-center gap-3">
              {SOCIALS.map((s) => (
                <a
                  key={s.label}
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-white/30 hover:text-white hover:bg-white/10 transition-all duration-300"
                  aria-label={s.label}
                >
                  <s.icon size={14} />
                </a>
              ))}
            </div>

            <div className="mt-4 flex items-center gap-3 font-mono text-xs text-white/40">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              System Operational
            </div>
          </div>

          {/* Nav columns */}
          <div className="md:col-span-8 grid grid-cols-2 sm:grid-cols-3 gap-8">
            {Object.entries(FOOTER_NAV).map(([title, links]) => (
              <div key={title}>
                <h4 className="font-heading font-semibold text-white/30 text-xs uppercase tracking-widest mb-4">
                  {title}
                </h4>
                <ul className="space-y-2.5">
                  {links.map((link) => (
                    <li key={link.label}>
                      <Link
                        to={link.to}
                        className="group flex items-center gap-1 text-sm text-white/60 hover:text-white transition-colors duration-300"
                      >
                        {link.label}
                        <ArrowUpRight
                          size={12}
                          className="opacity-0 -translate-y-0.5 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-300"
                        />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-8">
          <p className="text-white/30 text-xs">
            &copy; {new Date().getFullYear()} Diamond Orthotic Laboratory. All rights
            reserved.
          </p>
          <div className="flex items-center gap-6 text-white/30 text-xs">
            <span className="hover:text-white/60 transition-colors cursor-pointer">
              Privacy Policy
            </span>
            <span className="hover:text-white/60 transition-colors cursor-pointer">
              Terms of Service
            </span>
            <span className="hover:text-white/60 transition-colors cursor-pointer">
              FDA Compliance
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
