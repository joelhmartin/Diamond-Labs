/* A matching pair of medical-illustration figures: the same head and shoulders
   in silhouette, showing the jaw joint for TMD and the airway for sleep. */

const VIEW_BOX = "0 0 240 260";

const SILHOUETTE =
  "M6 260 C24 236 56 228 66 204 C71 192 60 172 50 156 C40 142 36 128 36 112 " +
  "C32 60 72 18 112 18 C146 18 168 40 172 72 C173 78 171 82 170 87 " +
  "C174 98 184 110 188 118 C190 123 186 127 180 127 C176 127 173 128 172 130 " +
  "C172 134 177 137 177 141 C177 143 172 144 171 145 C174 147 175 151 172 154 " +
  "C169 156 169 159 170 162 C172 170 168 180 156 182 C146 184 134 184 126 182 " +
  "C124 196 124 214 134 230 C146 242 176 246 200 260 Z";

/* Clockwise from the joint: condyle, notch, coronoid, tooth line, chin, lower border, jaw angle. */
const MANDIBLE =
  "M102 104 C102 97 114 97 115 104 C115 108 113 111 114 115 C116 120 120 120 123 116 " +
  "C125 112 127 108 130 106 C133 112 134 126 133 138 C140 143 150 145 160 144 " +
  "C164 149 165 158 163 165 C159 173 148 175 138 172 C126 169 112 169 103 160 " +
  "C97 152 99 122 102 104 Z";

const LOWER_TEETH = [136, 142, 148, 154, 160];
const UPPER_TEETH = [136, 142, 148, 154, 160, 166];

/* Nostril, across the nasal cavity, down the back of the throat into the windpipe. */
const AIRWAY = "M176 122 C160 108 128 104 112 112 C102 120 104 140 108 158 C112 180 112 210 110 260";
const TONGUE = "M124 160 C118 148 128 132 146 134 C158 135 168 142 170 150 C160 158 140 164 124 160 Z";
const PALATE = "M172 128 C156 124 142 122 132 124 C126 126 122 132 121 140";
const LOWER_JAW = "M170 162 C160 172 144 172 130 168 C126 166 124 164 122 162";

function Bust({ label, children }) {
  return (
    <svg viewBox={VIEW_BOX} className="block w-full h-full" role="img" aria-label={label}>
      <path d={SILHOUETTE} className="fill-navy" />
      {children}
    </svg>
  );
}

function Teeth({ xs, y, height }) {
  return xs.map((x) => (
    <rect key={x} x={x - 2.5} y={y} width="5" height={height} rx="2" className="fill-white" />
  ));
}

export function JawJointFigure({ active = true }) {
  return (
    <Bust label="Head in profile showing the jawbone and the jaw joint">
      <path d={MANDIBLE} className="fill-white/90" />
      <Teeth xs={LOWER_TEETH} y={136} height={9} />
      <Teeth xs={UPPER_TEETH} y={125} height={9} />
      <path
        d="M96 102 C100 90 118 90 123 102"
        fill="none"
        className="stroke-white/70"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      {active && (
        <circle
          cx="108.5"
          cy="104"
          r="11"
          className="fill-accent-500/40 motion-safe:animate-ping [transform-box:fill-box] [transform-origin:center]"
        />
      )}
      <circle cx="108.5" cy="104" r="7" className="fill-accent-500" />
    </Bust>
  );
}

export function AirwayFigure({ active = true }) {
  return (
    <Bust label="Head in profile showing an open airway from the nose to the windpipe">
      <path d={TONGUE} className="fill-white/25" />
      <path d={PALATE} fill="none" className="stroke-white/60" strokeWidth="2.5" strokeLinecap="round" />
      <path d={LOWER_JAW} fill="none" className="stroke-white/40" strokeWidth="2.5" strokeLinecap="round" />
      <path d={AIRWAY} fill="none" className="stroke-brand-500" strokeWidth="13" strokeLinecap="round" />
      <path
        d={AIRWAY}
        fill="none"
        className={`stroke-white ${active ? "motion-safe:animate-[airflow_1.4s_linear_infinite]" : ""}`}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray="6 6"
      />
    </Bust>
  );
}
