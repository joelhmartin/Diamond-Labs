import { afterEach, test, vi } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom";
import gsap from "gsap";
import { PageHero, playHeroIntro } from "./PageHero.jsx";
import { Reveal, revealOnView } from "./Reveal.jsx";
import { SectionHeading } from "./SectionHeading.jsx";
import { CtaBand } from "./CtaBand.jsx";
import { StatRow } from "./StatRow.jsx";

afterEach(() => vi.unstubAllGlobals());

const render = (el) => renderToStaticMarkup(<StaticRouter location="/">{el}</StaticRouter>);

test("PageHero renders one h1 containing the title and the accent line", () => {
  const html = render(<PageHero variant="compact" title="Digital orthotics" titleAccent="made precisely" />);
  assert.equal((html.match(/<h1/g) || []).length, 1);
  const h1 = html.match(/<h1[\s\S]*?<\/h1>/)[0];
  assert.match(h1, /Digital orthotics/);
  assert.match(h1, /made precisely/);
});

test("the compact variant renders no image", () => {
  const html = render(<PageHero variant="compact" title="Products" />);
  assert.doesNotMatch(html, /<img/);
});

test("the image variant renders its photo with the given alt text", () => {
  const html = render(<PageHero variant="image" title="About" image="/x.jpg" imageAlt="The lab floor" />);
  assert.match(html, /<img[^>]*alt="The lab floor"/);
  assert.match(html, /min-h-\[60dvh\]/);
});

test("CtaBand renders the primary label as a link to primary.to", () => {
  const html = render(<CtaBand title="Send a case" primary={{ label: "Contact the lab", to: "/contact" }} />);
  assert.match(html, /<a[^>]*href="\/contact"[^>]*>[\s\S]*Contact the lab/);
});

test("SectionHeading is a plain h2 by default", () => {
  const html = render(<SectionHeading title="Materials" intro="What we use." />);
  assert.match(html, /<h2[^>]*>Materials<\/h2>/);
});

test("StatRow renders each value and label", () => {
  const html = render(<StatRow tone="dark" stats={[{ value: "10", label: "business days" }]} />);
  assert.match(html, /10/);
  assert.match(html, /business days/);
});

const motion = (reduce) =>
  vi.stubGlobal("matchMedia", (q) => ({ matches: reduce && /reduce/.test(q) }));

test("hero content is never hidden in the initial markup", () => {
  for (const variant of ["image", "compact"]) {
    const html = render(
      <PageHero variant={variant} title="T" titleAccent="A" intro="I" image="/x.jpg" imageAlt="alt">
        <button>Go</button>
      </PageHero>
    );
    assert.doesNotMatch(html, /opacity:\s*0(?![.\d])/);
  }
});

test("the hero intro does not animate under reduced motion, and does otherwise", () => {
  const from = vi.spyOn(gsap, "from").mockImplementation(() => ({}));
  motion(true);
  playHeroIntro({});
  assert.equal(from.mock.calls.length, 0);
  motion(false);
  playHeroIntro({})?.revert();
  assert.equal(from.mock.calls.length, 1);
  from.mockRestore();
});

test("Reveal markup is never hidden, and revealOnView is skipped under reduced motion", () => {
  assert.doesNotMatch(render(<Reveal className="x">hi</Reveal>), /opacity:\s*0(?![.\d])/);
  const fromTo = vi.spyOn(gsap, "fromTo").mockImplementation(() => ({ play() {} }));
  vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} });
  motion(true);
  revealOnView({})();
  assert.equal(fromTo.mock.calls.length, 0);
  motion(false);
  revealOnView({})();
  assert.equal(fromTo.mock.calls.length, 1);
  assert.deepEqual(fromTo.mock.calls[0][1], { y: 40, opacity: 0 });
  fromTo.mockRestore();
});

/* ---- Task 2: navigation and footer ---- */
import { NAV_LINKS } from "./Navbar.jsx";
import { Footer } from "./Footer.jsx";

const flatNav = () => NAV_LINKS.flatMap((l) => [l, ...(l.children || [])]);

test("the nav has no Dr. Olmos entry and names the courses link plainly", () => {
  const all = flatNav();
  assert.ok(!all.some((l) => l.to === "/about/dr-olmos"));
  assert.ok(!all.some((l) => /Dr\. Steven Olmos/.test(l.label)));
  const courses = all.find((l) => l.label === "Courses");
  assert.equal(courses?.to, "/resources/courses");
  assert.ok(NAV_LINKS.some((l) => l.label === "Resources"));
});

test("the footer has no status line and links each name to its page", () => {
  const html = render(<Footer />);
  assert.doesNotMatch(html, /System Operational/);
  assert.match(html, /<a[^>]*href="\/services\/digital-workflow"[^>]*>[^<]*Digital Workflow/);
  assert.match(html, /<a[^>]*href="\/submit-case"[^>]*>[^<]*Case Submission/);
  assert.doesNotMatch(html, /Olmos-Method|Olmos Series/);
});

test("/about/dr-olmos is still registered in App.jsx", () => {
  const src = readFileSync(new URL("../../App.jsx", import.meta.url), "utf8");
  assert.match(src, /path="\/about\/dr-olmos"/);
});
