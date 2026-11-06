/* A matching pair of clinical line drawings: the same head in profile, with the
   jaw joint highlighted for TMD and the airway highlighted for sleep. */

const VIEW_BOX = "0 0 120 124";

const HEAD =
  "M38 118 C37 102 26 90 24 70 C20 42 38 14 64 14 C82 14 94 27 96 43 C97 47 96 50 97 53 " +
  "C100 58 105 64 106 67 C107 70 103 71 100 71 C100 74 102 76 101 78 C100.5 79.5 99 80 99 81 " +
  "C100.5 82 101 84 99 86 C100 90 99 96 94 97 C86 99 77 98 72 96 C70 102 70 110 72 118";

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

export function AirwayFigure({ active = true }) {
  return (
    <HeadProfile label="Side profile of a head with an open airway highlighted">
      <path d={AIRWAY} className="stroke-brand-500/25" strokeWidth="9" strokeLinecap="round" />
      <path
        d={AIRWAY}
        className={`stroke-brand-600 ${active ? "motion-safe:animate-[airflow_1.4s_linear_infinite]" : ""}`}
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="6 6"
      />
    </HeadProfile>
  );
}
