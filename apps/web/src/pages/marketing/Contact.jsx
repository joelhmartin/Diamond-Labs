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
import { HeroStage } from "../../components/marketing/HeroStage";

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
  // Fields holding text keep their label floated, so autofilled values never sit under it.
  const [filled, setFilled] = useState({});
  const floated = (name) => focused[name] || filled[name];
  const trackValue = (e) => setFilled((prev) => ({ ...prev, [e.target.name]: e.target.value !== "" }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    setFormState("sending");
    try {
      await postContactMessage(new FormData(form));
      form.reset();
      setFocused({});
      setFilled({});
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
              htmlFor={`contact-${field.name}`}
              className={`absolute left-4 transition-all duration-300 pointer-events-none ${
                floated(field.name)
                  ? "top-2 text-[10px] text-brand-700 font-semibold"
                  : "top-4 text-sm text-navy/70"
              }`}
            >
              {field.label}
            </label>
            <input
              id={`contact-${field.name}`}
              type={field.type}
              name={field.name}
              required={field.required}
              maxLength={field.maxLength}
              className="w-full pt-6 pb-2 px-4 rounded-2xl bg-surface-100 border border-surface-300/50 text-navy text-sm focus:outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/15 transition-all duration-300"
              onChange={trackValue}
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
          htmlFor="contact-subject"
          className={`absolute left-4 transition-all duration-300 pointer-events-none ${
            floated("subject")
              ? "top-2 text-[10px] text-brand-700 font-semibold"
              : "top-4 text-sm text-navy/70"
          }`}
        >
          Subject
        </label>
        <select
          id="contact-subject"
          name="subject"
          onChange={trackValue}
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
          htmlFor="contact-message"
          className={`absolute left-4 transition-all duration-300 pointer-events-none ${
            floated("message")
              ? "top-2 text-[10px] text-brand-700 font-semibold"
              : "top-4 text-sm text-navy/70"
          }`}
        >
          Message
        </label>
        <textarea
          id="contact-message"
          name="message"
          onChange={trackValue}
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

      <p role="status" className="sr-only">
        {formState === "success" ? "Message sent." : ""}
      </p>

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
    { icon: Mail, label: "Email", value: "info@diamondorthotic.com", href: "mailto:info@diamondorthotic.com" },
    { icon: Phone, label: "Phone", value: "619.724.6400", mono: true, href: "tel:+16197246400" },
    { icon: MapPin, label: "Location", value: "La Mesa, California" },
    { icon: Clock, label: "Hours", value: "Mon–Fri, 8:00 AM – 5:00 PM PST" },
  ];

  return (
    <div className="relative overflow-hidden rounded-[2.5rem] md:rounded-[3rem] bg-navy">
      <HeroStage />
      <div className="relative z-10 p-8 md:p-12">
        <h2 className="font-heading font-bold text-3xl md:text-4xl tracking-tight text-on-dark">Get in touch</h2>
        <p className="mt-3 text-on-dark/75 leading-relaxed max-w-sm">
          Whether you have questions about our products, need help with case
          submission, or want to learn about our digital workflow — we&apos;re
          here to help.
        </p>

        <ul className="mt-8 space-y-3">
          {items.map((item) => (
            <li
              key={item.label}
              className="flex items-center gap-4 rounded-2xl bg-white/[0.07] border border-white/10 backdrop-blur-sm p-4"
            >
              <span className="grid place-items-center w-12 h-12 rounded-2xl bg-brand-500/20 text-brand-300 flex-shrink-0">
                <item.icon size={20} aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <span className="block text-xs text-on-dark/70">{item.label}</span>
                <span className={`block font-medium text-on-dark ${item.mono ? "font-mono" : ""}`}>
                  {item.href ? (
                    <a href={item.href} className="hover:underline">
                      {item.value}
                    </a>
                  ) : (
                    item.value
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>

        {/* Social links */}
        <div className="mt-8 pt-6 border-t border-white/15">
          <span className="text-xs text-on-dark/70">Follow us</span>
          <div className="mt-3 flex items-center gap-3">
            {SOCIALS.map((s) => (
              <a
                key={s.label}
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
                className="w-11 h-11 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center text-on-dark/85 hover:bg-white/20 transition-all duration-300"
                aria-label={s.label}
              >
                <s.icon size={18} />
              </a>
            ))}
          </div>
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
        title="Contact"
        titleAccent="the lab."
        intro="Questions about a product, a case in progress or setting up an account. Call, email or use the form."
        product="/images/onp-clear.webp"
        productAlt="An ONP appliance on a blue dental model"
      />
      <Reveal className="section-pad py-16 md:py-24">
        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-10 items-start">
          <ContactInfo />
          <div className="bg-white rounded-[2.5rem] md:rounded-[3rem] p-6 md:p-10 border border-surface-300/60 shadow-xl shadow-navy/10">
            <ContactForm />
          </div>
        </div>
      </Reveal>
    </>
  );
}
