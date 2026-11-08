/* A matching pair of clinical line drawings: the same head in profile, with the
   jaw joint highlighted for TMD and the airway highlighted for sleep. */

const VIEW_BOX = "0 0 120 124";

/* From the back of the neck: nape, back of the skull, crown, forehead, brow, nose, lips, chin, throat. */
const HEAD =
  "M30 118 C31 108 35 100 35 92 C35 84 21 70 19 50 C18 28 38 11 62 11 C80 11 92 21 95 37 " +
  "C96 41 96 44 95.5 46 C95 48 94 50 95 52 C97 57 103 62 106 66 C107.5 69 104 71 100 71 " +
  "C99.5 73 101.5 75 101.5 77 C101.5 78.5 99 79 98.5 80 C100 81 101 83 99.5 85 " +
  "C98 86 97.5 87 98 89 C100 92 98.5 96 94 97.5 C86 99.5 78 98 72 96 C70 102 70 110 74 118";

const MANDIBLE =
  "M56 54 C60 52 63 55 62 59 L61 73 C63 79 70 83 80 83 L94 82 C98 83 99 89 96 93 " +
  "C90 97 78 96 70 93 C60 90 53 85 52 77 L53 60 C53 57 54 55 56 54 Z";

const AIRWAY = "M101 65 C88 58 72 58 65 65 C59 72 59 84 61 96 C62 102 62 106 62 111";

function HeadProfile({ children, label }) {
  return (
    <svg viewBox={VIEW_BOX} className="w-full h-full" fill="none" role="img" aria-label={label}>
      {children}
      <path
        d={HEAD}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function JawJointFigure({ active = true }) {
  return (
    <HeadProfile label="Side profile of a head with the jaw joint highlighted">
      <path
        d={MANDIBLE}
        className="fill-brand-500/15 stroke-brand-600"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M47 51 C51 44 62 44 67 51"
        className="stroke-navy/50"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {active && (
        <circle
          cx="57.5"
          cy="55"
          r="7"
          className="fill-accent-500/30 motion-safe:animate-ping [transform-box:fill-box] [transform-origin:center]"
        />
      )}
      <circle cx="57.5" cy="55" r="4" className="fill-accent-500" />
    </HeadProfile>
  );
}

export function AirwayFigure() {
  return (
    <HeadProfile label="Side profile of a head with an open airway highlighted">
      <path d={AIRWAY} className="stroke-brand-500/25" strokeWidth="9" strokeLinecap="round" />
      <path
        d={AIRWAY}
        className="stroke-brand-600 motion-safe:animate-[airflow_0.9s_linear_infinite]"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="6 6"
      />
    </HeadProfile>
  );
}
