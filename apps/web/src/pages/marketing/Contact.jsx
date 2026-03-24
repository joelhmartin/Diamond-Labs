import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  Mail,
  Phone,
  MapPin,
  Clock,
  Send,
  CheckCircle,
  Loader2,
  Facebook,
  Instagram,
  Linkedin,
  Youtube,
} from "lucide-react";

gsap.registerPlugin(ScrollTrigger);

const SOCIALS = [
  { icon: Facebook, href: "https://facebook.com/diamondorthotic", label: "Facebook" },
  { icon: Instagram, href: "https://instagram.com/diamondorthotic", label: "Instagram" },
  { icon: Linkedin, href: "https://linkedin.com/company/diamond-orthotic-laboratory", label: "LinkedIn" },
  { icon: Youtube, href: "https://youtube.com/@diamondorthotic", label: "YouTube" },
];

/* ─── CONTACT HERO ─── */
function ContactHero() {
  const heroRef = useRef(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from("[data-chero]", {
        y: 40,
        opacity: 0,
        duration: 1,
        stagger: 0.08,
        ease: "power3.out",
        delay: 0.3,
      });
    }, heroRef);
    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={heroRef}
      className="relative h-[45dvh] min-h-[350px] flex items-end overflow-hidden"
    >
      <div className="absolute inset-0">
        <img
          src="https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?auto=format&fit=crop&w=1920&q=80"
          alt="Precision medical work"
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-navy via-navy/80 to-navy/40" />
        <div className="absolute inset-0 bg-gradient-to-t from-navy via-transparent to-transparent" />
      </div>
      <div className="relative z-10 section-pad pb-12 md:pb-16 max-w-3xl">
        <span data-chero className="font-mono text-xs text-white/40 uppercase tracking-widest">
          Contact
        </span>
        <h1 data-chero className="mt-4 text-white">
          <span className="block font-heading font-bold text-3xl sm:text-4xl md:text-6xl tracking-tight leading-[0.95]">
            Let&apos;s talk about
          </span>
          <span className="block font-drama italic text-4xl sm:text-5xl md:text-7xl tracking-tight leading-[0.9] text-brand-500">
            your next case.
          </span>
        </h1>
      </div>
    </section>
  );
}

/* ─── CONTACT FORM ─── */
function ContactForm() {
  const [formState, setFormState] = useState("idle");
  const [focused, setFocused] = useState({});

  const handleSubmit = (e) => {
    e.preventDefault();
    setFormState("sending");
    setTimeout(() => setFormState("success"), 1500);
    setTimeout(() => setFormState("idle"), 4000);
  };

  const fields = [
    { name: "name", label: "Full Name", type: "text" },
    { name: "practice", label: "Practice Name", type: "text" },
    { name: "email", label: "Email Address", type: "email" },
    { name: "phone", label: "Phone Number", type: "tel" },
  ];

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {fields.map((field) => (
          <div key={field.name} className="relative">
            <label
              className={`absolute left-4 transition-all duration-300 pointer-events-none ${
                focused[field.name]
                  ? "top-2 text-[10px] text-brand-500 font-semibold"
                  : "top-4 text-sm text-navy/40"
              }`}
            >
              {field.label}
            </label>
            <input
              type={field.type}
              name={field.name}
              className="w-full pt-6 pb-2 px-4 rounded-2xl bg-surface-100 border border-surface-300/50 text-navy text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 transition-all duration-300"
              onFocus={() =>
                setFocused((prev) => ({ ...prev, [field.name]: true }))
              }
              onBlur={(e) => {
                if (!e.target.value) {
                  setFocused((prev) => ({ ...prev, [field.name]: false }));
                }
              }}
            />
          </div>
        ))}
      </div>

      <div className="relative">
        <label
          className={`absolute left-4 transition-all duration-300 pointer-events-none ${
            focused.subject
              ? "top-2 text-[10px] text-brand-500 font-semibold"
              : "top-4 text-sm text-navy/40"
          }`}
        >
          Subject
        </label>
        <select
          name="subject"
          className="w-full pt-6 pb-2 px-4 rounded-2xl bg-surface-100 border border-surface-300/50 text-navy text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 transition-all duration-300 appearance-none cursor-pointer"
          onFocus={() =>
            setFocused((prev) => ({ ...prev, subject: true }))
          }
          onBlur={(e) => {
            if (!e.target.value) {
              setFocused((prev) => ({ ...prev, subject: false }));
            }
          }}
          defaultValue=""
        >
          <option value="" disabled></option>
          <option>New Case Inquiry</option>
          <option>Product Information</option>
          <option>Digital Workflow Setup</option>
          <option>Existing Case Question</option>
          <option>General Question</option>
        </select>
      </div>

      <div className="relative">
        <label
          className={`absolute left-4 transition-all duration-300 pointer-events-none ${
            focused.message
              ? "top-2 text-[10px] text-brand-500 font-semibold"
              : "top-4 text-sm text-navy/40"
          }`}
        >
          Message
        </label>
        <textarea
          name="message"
          rows={4}
          className="w-full pt-6 pb-2 px-4 rounded-2xl bg-surface-100 border border-surface-300/50 text-navy text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 transition-all duration-300 resize-none"
          onFocus={() =>
            setFocused((prev) => ({ ...prev, message: true }))
          }
          onBlur={(e) => {
            if (!e.target.value) {
              setFocused((prev) => ({ ...prev, message: false }));
            }
          }}
        />
      </div>

      <button
        type="submit"
        disabled={formState !== "idle"}
        className={`btn-magnetic w-full py-4 rounded-full font-semibold text-sm transition-all duration-500 ${
          formState === "success"
            ? "bg-emerald-500 text-white"
            : "bg-accent-500 text-white"
        }`}
      >
        <span className="btn-bg bg-accent-600 rounded-full" />
        <span className="relative z-10 flex items-center justify-center gap-2">
          {formState === "idle" && (
            <>
              Send Message <Send size={16} />
            </>
          )}
          {formState === "sending" && (
            <>
              Sending <Loader2 size={16} className="animate-spin" />
            </>
          )}
          {formState === "success" && (
            <>
              Message Sent <CheckCircle size={16} />
            </>
          )}
        </span>
      </button>
    </form>
  );
}

/* ─── CONTACT INFO ─── */
function ContactInfo() {
  const items = [
    { icon: Mail, label: "Email", value: "info@diamondorthotic.com" },
    { icon: Phone, label: "Phone", value: "(555) 123-4567" },
    { icon: MapPin, label: "Location", value: "San Diego, California" },
    { icon: Clock, label: "Hours", value: "Mon–Fri, 8:00 AM – 5:00 PM PST" },
  ];

  return (
    <div>
      <h2 className="font-heading font-bold text-2xl md:text-3xl tracking-tight">
        Get in touch.
      </h2>
      <p className="mt-3 text-navy/50 text-sm leading-relaxed max-w-sm">
        Whether you have questions about our products, need help with case
        submission, or want to learn about our digital workflow — we&apos;re
        here to help.
      </p>

      <div className="mt-8 space-y-4">
        {items.map((item, i) => (
          <div key={i} className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-brand-500/10 flex items-center justify-center flex-shrink-0">
              <item.icon size={16} className="text-brand-500" />
            </div>
            <div>
              <span className="font-mono text-[10px] text-navy/30 uppercase tracking-wider">
                {item.label}
              </span>
              <p className="text-sm font-medium text-navy/80">{item.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Social links */}
      <div className="mt-8 pt-6 border-t border-surface-300/30">
        <span className="font-mono text-[10px] text-navy/30 uppercase tracking-wider">
          Follow Us
        </span>
        <div className="mt-3 flex items-center gap-3">
          {SOCIALS.map((s) => (
            <a
              key={s.label}
              href={s.href}
              target="_blank"
              rel="noopener noreferrer"
              className="w-10 h-10 rounded-xl bg-surface-100 border border-surface-300/50 flex items-center justify-center text-navy/40 hover:text-brand-500 hover:border-brand-500/30 transition-all duration-300"
              aria-label={s.label}
            >
              <s.icon size={16} />
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── PAGE EXPORT ─── */
export function ContactPage() {
  const sectionRef = useRef(null);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from("[data-contact-anim]", {
        y: 40,
        opacity: 0,
        duration: 0.8,
        stagger: 0.1,
        ease: "power3.out",
      });
    }, sectionRef);
    return () => ctx.revert();
  }, []);

  return (
    <div ref={sectionRef}>
      <ContactHero />

      {/* Main contact section */}
      <section className="section-pad py-16 md:py-24">
        <div className="max-w-6xl mx-auto">
          <div
            data-contact-anim
            className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16"
          >
            <ContactInfo />
            <div className="bg-white card-radius p-6 md:p-8 border border-surface-300/50 shadow-sm">
              <ContactForm />
            </div>
          </div>
        </div>
      </section>

      {/* Ambient image */}
      <section className="section-pad pb-8">
        <div className="max-w-6xl mx-auto">
          <div className="relative w-full aspect-[21/9] rounded-[2rem] overflow-hidden">
            <img
              src="https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1920&q=80"
              alt="Modern office environment"
              className="w-full h-full object-cover"
              loading="lazy"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-brand-500/20 to-navy/30" />
          </div>
        </div>
      </section>
    </div>
  );
}
