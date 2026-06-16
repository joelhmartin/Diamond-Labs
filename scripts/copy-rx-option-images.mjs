import { readdirSync, copyFileSync, mkdirSync } from "fs";
const src = "docs/rx-forms/jotform-images/options";
const dst = "apps/web/public/images/rx/options";
mkdirSync(dst, { recursive: true });
const map = {
  "bite_150": "bite_150.png", "PVS_150": "PVS_150.png", "model_150": "model_150.png",
  "3shape_": "3shape.png", "carestream_": "carestream.png", "cerec_": "cerec.png",
  "itero_": "itero.png", "medit_": "medit.png", "midmark_": "midmark.png",
  "shining": "shining.png", "planmeca": "planmeca.png", "all.": "all.png",
  "ddso_post": "ddso_post.png", "ddso_anterior": "ddso_anterior.png",
  "ddso_full": "ddso_full.png", "ddso_tripod": "ddso_tripod.png",
  "Standard.": "design_standard.png", "buccalfree": "design_buccalfree.png",
  "Full_20Coverage": "design_full.png",
};
for (const f of readdirSync(src)) {
  const key = Object.keys(map).find((k) => f.startsWith(k));
  if (key) copyFileSync(`${src}/${f}`, `${dst}/${map[key]}`);
}
console.log("copied rx option images");
