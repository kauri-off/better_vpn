/**
 * The Better VPN mark: a shield (secure) with stacked upward chevrons
 * (faster / "better"). Inlined as a component so it scales crisply and
 * inherits sizing via className regardless of the deploy subpath.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className} role="img" aria-label="Better VPN">
      <defs>
        <linearGradient id="bv-grad" x1="12" y1="4" x2="52" y2="60" gradientUnits="userSpaceOnUse">
          <stop stopColor="#4f8cff" />
          <stop offset="1" stopColor="#2f6bff" />
        </linearGradient>
      </defs>
      <path
        d="M32 4 L52.5 11.2 C53.4 11.5 54 12.4 54 13.4 V30.5 C54 44.7 44.6 53.9 32.6 59.6 C32.2 59.8 31.8 59.8 31.4 59.6 C19.4 53.9 10 44.7 10 30.5 V13.4 C10 12.4 10.6 11.5 11.5 11.2 Z"
        fill="url(#bv-grad)"
      />
      <path
        d="M24.5 31 L32 24 L39.5 31"
        stroke="#ffffff"
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.55"
      />
      <path
        d="M21 40 L32 29 L43 40"
        stroke="#ffffff"
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
