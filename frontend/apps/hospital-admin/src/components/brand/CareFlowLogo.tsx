/**
 * CareFlow AI brand identity.
 *
 * Abstract mark: a continuous care-flow loop with three connection nodes
 * and a single subtle pulse notch (clinical reference without crosses,
 * stethoscopes, or AI cliches). Works on light/dark, sidebar/navbar,
 * and as favicon (icon only).
 */

export function CareFlowMark({
  size = 36,
  rounded = 10,
}: {
  size?: number;
  rounded?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="none"
      role="img"
      aria-label="CareFlow AI mark"
    >
      <rect width="36" height="36" rx={rounded} fill="#0E2E4A" />
      {/* continuous care-flow loop */}
      <path
        d="M7 22.5C10.5 22.5 10.5 18 14.5 18H16.2L17.4 14.5L19.2 21.5L20.3 18H21.5C25.5 18 25.5 22.5 29 22.5"
        stroke="#FFFFFF"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* teal flow accent — connection */}
      <path
        d="M7 26.5C11 26.5 12 24 15 24H21C24 24 25 26.5 29 26.5"
        stroke="#3AA8A8"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      {/* connection nodes */}
      <circle cx="7" cy="22.5" r="2.1" fill="#3AA8A8" />
      <circle cx="29" cy="22.5" r="2.1" fill="#FFFFFF" />
      <circle cx="7" cy="22.5" r="0.9" fill="#0E2E4A" />
    </svg>
  );
}

export function CareFlowLogo({
  theme = "light",
  compact = false,
  size = 36,
  tagline = false,
}: {
  theme?: "light" | "dark";
  compact?: boolean;
  size?: number;
  tagline?: boolean;
}) {
  const word = theme === "dark" ? "#FFFFFF" : "#0E2E4A";
  const sub = theme === "dark" ? "rgba(255,255,255,0.62)" : "#5B6B7C";
  if (compact) return <CareFlowMark size={size} />;
  return (
    <span className="inline-flex items-center gap-2.5 select-none" aria-label="CareFlow AI">
      <CareFlowMark size={size} />
      <span className="leading-none">
        <span
          className="block font-bold tracking-tight"
          style={{ color: word, fontSize: size * 0.52, letterSpacing: "-0.02em" }}
        >
          CareFlow{" "}
          <span style={{ color: "#168C8C", fontWeight: 600, fontSize: "0.72em", letterSpacing: "0.04em" }}>
            AI
          </span>
        </span>
        {tagline && (
          <span
            className="block font-semibold uppercase"
            style={{ color: sub, fontSize: 9.5, letterSpacing: "0.14em", marginTop: 3 }}
          >
            Hospital Operations
          </span>
        )}
      </span>
    </span>
  );
}
