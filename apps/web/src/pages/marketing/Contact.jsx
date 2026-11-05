import { useState } from "react";
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
import { CONTACT_SUBJECTS } from "@my-app/shared";
import { PageHero } from "../../components/marketing/PageHero";
import { Reveal } from "../../components/marketing/Reveal";

const SOCIALS = [
  { icon: Facebook, href: "https://facebook.com/diamondorthotic", label: "Facebook" },
  { icon: Instagram, href: "https://instagram.com/diamondorthotic", label: "Instagram" },
  { icon: Linkedin, href: "https://linkedin.com/company/diamond-orthotic-laboratory", label: "LinkedIn" },
  { icon: Youtube, href: "https://youtube.com/@diamondorthotic", label: "YouTube" },
];

/* ─── CONTACT FORM ─── */
/** Sends the form's filled-in fields; throws unless the API accepted them. */
export async function postContactMessage(formData) {
  const res = await fetch("/api/v1/contact", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      Object.fromEntries([...formData].filter(([, value]) => value !== ""))
    ),
  });
  if (!res.ok) throw new Error(`Contact form returned ${res.status}`);
}

function ContactForm() {
  const [formState, setFormState] = useState("idle");
  const [focused, setFocused] = useState({});

  const handleSubmit = async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    setFormState("sending");
    try {
      await postContactMessage(new FormData(form));
      form.reset();
      setFocused({});
      setFormState("success");
      setTimeout(() => setFormState("idle"), 4000);
    } catch {
      setFormState("error");
    }
  };

  const fields = [
    { name: "name", label: "Full Name", type: "text", required: true, maxLength: 200 },
    { name: "practice", label: "Practice Name", type: "text", maxLength: 200 },
    { name: "email", label: "Email Address", type: "email", required: true, maxLength: 320 },
    { name: "phone", label: "Phone Number", type: "tel", maxLength: 50 },
  ];

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {fields.map((field) => (
          <div key={field.name} className="relative">
            <label
              className={`absolute left-4 transition-all duration-300 pointer-events-none ${
                focused[field.name]
                  ? "top-2 text-[10px] text-brand-700 font-semibold"
                  : "top-4 text-sm text-navy/70"
              }`}
            >
              {field.label}
            </label>
            <input
              type={field.type}
              name={field.name}
              required={field.required}
              maxLength={field.maxLength}
              className="w-full pt-6 pb-2 px-4 rounded-2xl bg-surface-100 border border-surface-300/50 text-navy text-sm focus:outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/15 transition-all duration-300"
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
              ? "top-2 text-[10px] text-brand-700 font-semibold"
              : "top-4 text-sm text-navy/70"
          }`}
        >
          Subject
        </label>
        <select
          name="subject"
          className="w-full pt-6 pb-2 px-4 rounded-2xl bg-surface-100 border border-surface-300/50 text-navy text-sm focus:outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/15 transition-all duration-300 appearance-none cursor-pointer"
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
          {CONTACT_SUBJECTS.map((subject) => (
            <option key={subject}>{subject}</option>
          ))}
        </select>
      </div>

      <div className="relative">
        <label
          className={`absolute left-4 transition-all duration-300 pointer-events-none ${
            focused.message
              ? "top-2 text-[10px] text-brand-700 font-semibold"
              : "top-4 text-sm text-navy/70"
          }`}
        >
          Message
        </label>
        <textarea
          name="message"
          required
          maxLength={5000}
          rows={4}
          className="w-full pt-6 pb-2 px-4 rounded-2xl bg-surface-100 border border-surface-300/50 text-navy text-sm focus:outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/15 transition-all duration-300 resize-none"
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

      <p className="text-xs text-navy/70">
        Please don&apos;t include patient details in this form.
      </p>

      {/* Honeypot: hidden from people, filled in by bots. The name avoids anything
          browsers autofill, or a real visitor would be silently dropped. */}
      <div aria-hidden="true" className="sr-only pointer-events-none">
        <input type="text" name="contact_hp_check" tabIndex={-1} autoComplete="off" />
      </div>

      {formState === "error" && (
        <p role="alert" className="text-sm text-navy">
          Your message wasn&apos;t sent. Try again, or call the lab at{" "}
          <a href="tel:+16197246400" className="font-semibold underline">
            619.724.6400
          </a>
          .
        </p>
      )}

      <button
        type="submit"
        disabled={formState === "sending" || formState === "success"}
        className={`btn-magnetic w-full py-4 rounded-full font-semibold text-sm transition-all duration-500 ${
          formState === "success"
            ? "bg-navy text-white"
            : "bg-accent-500 text-white"
        }`}
      >
        <span className="btn-bg bg-accent-600 rounded-full" />
        <span className="relative z-10 flex items-center justify-center gap-2">
          {(formState === "idle" || formState === "error") && (
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
    { icon: Phone, label: "Phone", value: "619.724.6400", mono: true },
    { icon: MapPin, label: "Location", value: "La Mesa, California" },
    { icon: Clock, label: "Hours", value: "Mon–Fri, 8:00 AM – 5:00 PM PST" },
  ];

  return (
    <div>
      <h2 className="font-heading font-bold text-2xl md:text-3xl tracking-tight">
        Get in touch.
      </h2>
      <p className="mt-3 text-navy/70 text-sm leading-relaxed max-w-sm">
        Whether you have questions about our products, need help with case
        submission, or want to learn about our digital workflow — we&apos;re
        here to help.
      </p>

      <div className="mt-8 space-y-4">
        {items.map((item, i) => (
          <div key={i} className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-brand-500/10 flex items-center justify-center flex-shrink-0">
              <item.icon size={16} className="text-brand-700" />
            </div>
            <div>
              <span className="text-xs text-navy/70">{item.label}</span>
              <p className={`text-sm font-medium text-navy ${item.mono ? "font-mono" : ""}`}>{item.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Social links */}
      <div className="mt-8 pt-6 border-t border-surface-300/30">
        <span className="text-xs text-navy/70">Follow us</span>
        <div className="mt-3 flex items-center gap-3">
          {SOCIALS.map((s) => (
            <a
              key={s.label}
              href={s.href}
              target="_blank"
              rel="noopener noreferrer"
              className="w-10 h-10 rounded-xl bg-surface-100 border border-surface-300/50 flex items-center justify-center text-navy/70 hover:text-brand-700 hover:border-brand-700/40 transition-all duration-300"
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
  return (
    <>
      <PageHero
        variant="image"
        title="Contact the lab"
        intro="Questions about a product, a case in progress or setting up an account. Call, email or use the form."
        image="/images/hero.webp"
        imageAlt="A white sleep appliance with blue connectors on a dark surface"
      />
      <Reveal className="section-pad py-16 md:py-24">
        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16">
          <ContactInfo />
          <div className="bg-white card-radius p-6 md:p-8 border border-surface-300/50 shadow-sm">
            <ContactForm />
          </div>
        </div>
      </Reveal>
    </>
  );
}
