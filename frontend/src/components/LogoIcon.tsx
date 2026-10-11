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
      <g transform="translate(256 256) scale(0.62 1) rotate(-90) translate(-14 0)" fill="none" stroke="#FFFFFF" stroke-width="44" stroke-linecap="round" stroke-linejoin="round">
        <path d="M-40 -116 V116" />
        <path d="M76 -108 L-20 0 L76 108" />
      </g>
    </svg>
  );
}
