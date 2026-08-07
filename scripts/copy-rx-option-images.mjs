import { readdirSync, copyFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "docs/rx-forms/jotform-images/options");
const dst = path.join(root, "apps/web/public/images/rx/options");
mkdirSync(dst, { recursive: true });
const map = {
  "bite_150": "bite_150.png", "PVS_150": "PVS_150.png", "model_150": "model_150.png",
  "3shape_": "3shape.png", "carestream_": "carestream.png", "cerec_": "cerec.png",
  "itero_": "itero.png", "medit_": "medit.png", "midmark_": "midmark.png",
  "shining": "shining.png", "planmeca": "planmeca.png",
  // trailing dot prevents prefix-collision with longer filenames (e.g. "all_other" won't match "all.")
  "all.": "all.png",
  "ddso_post": "ddso_post.png", "ddso_anterior": "ddso_anterior.png",
  "ddso_full": "ddso_full.png", "ddso_tripod": "ddso_tripod.png",
  // trailing dot prevents prefix-collision with longer filenames (e.g. "Standard_Other" won't match "Standard.")
  "Standard.": "design_standard.png", "buccalfree": "design_buccalfree.png",
  "Full_20Coverage": "design_full.png",
  // -- OD (Olmos Day) base-material photos --
  "od-pmt-sm": "od_pmt.png", "OD_BIoflex": "od_bioflex.png",
  "od-nylon-sm": "od_nylon.png", "od-acrylic-sm": "od_acrylic.png",
  // od-dual-laminate-sm has two archived files sharing a long common prefix
  // ("...68871109."): the short one is "Dual-Laminate", the long one (extra
  // ".6526b2437b1164.26558223" hash segment before .png) is "Milled" — and is
  // reused verbatim for the Mistry "MORA" option. Keying the short file by
  // its FULL filename (incl. ".png") means it can only exact-match itself —
  // the long file's extra hash segment before its own ".png" means it never
  // starts with the short file's full name, so no trailing-dot guard needed.
  "od-dual-laminate-sm.64a83f9c1b9b33.68871109.png": "od_dual_laminate.png",
  "od-dual-laminate-sm.64a83f9c1b9b33.68871109.6526b2437b1164": "od_milled.png",
  // -- ON (Olmos Night) design renders --
  "OND_rx_image": "on_deprogrammer.png", "ONP-rx": "on_positioner.png",
  "ont22": "on_titration.png", "ON-Rrx": "on_ramp.png",
  // -- Digital Device Modifications (sets A + B) --
  "Screenshot_202021": "mod_tongue_positioners.png", "hookss": "mod_hooks.png",
  "shims11": "mod_vertical_shims.png",
  "ONP1": "mod_on_loop.png", "BAB.": "mod_bab_loop.png", "ONr1": "mod_on_ramp.png",
  // -- Nightguard device renders --
  "slider-rx": "nightguard_slider.png", "FLAT-RX": "nightguard_flatplane.png",
  "nightguard": "nightguard_single.png",
  // -- Sport-guard device renders --
  "Picture2": "sportguard_trainer.png", "DEP_ProF": "sportguard_pro.png",
  "cad-cam_sportsguard": "sportguard_cadcam.png",
  // -- Mistry Protocol --
  "ARA.": "mistry_ara.png",
  // -- DDSO/D-Pro/Shirazi "Design preference" widget's "Standard" value maps
  // to the "std" file (the "Standard." file above is "Lingual-Free" — a
  // pre-existing JotForm value/filename mismatch, left as-is). --
  "std": "design_std.png",
};
const files = readdirSync(src);
let n = 0;
for (const f of files) {
  const key = Object.keys(map).find((k) => f.startsWith(k));
  if (key) { copyFileSync(path.join(src, f), path.join(dst, map[key])); n++; }
}
console.log(`copied ${n} of ${files.length} rx option images`);
