/** KouTube mark: rotated-narrowed K on the Grape tile. Decorative — the
 * wordmark carries the accessible name, so this is always aria-hidden. */
export default function LogoIcon({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="512" height="512" rx="120" fill="#6750A4" />
      <g transform="translate(256 276) scale(1 1) rotate(-90) translate(-8 0)" fill="none" stroke="#FFFFFF" strokeWidth={56} strokeLinecap="round" strokeLinejoin="round">
        <path d="M-50 -112 V112" />
        <path d="M128 -100 L20 0 L128 100" />
      </g>
    </svg>
  );
}
