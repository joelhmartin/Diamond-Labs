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
};
const files = readdirSync(src);
let n = 0;
for (const f of files) {
  const key = Object.keys(map).find((k) => f.startsWith(k));
  if (key) { copyFileSync(path.join(src, f), path.join(dst, map[key])); n++; }
}
console.log(`copied ${n} of ${files.length} rx option images`);
