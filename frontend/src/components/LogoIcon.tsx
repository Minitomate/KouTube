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
      <g transform="translate(256 256) scale(0.62 1) rotate(-90) translate(-8 0)" fill="none" stroke="#FFFFFF" stroke-width="56" stroke-linecap="round" stroke-linejoin="round">
        <path d="M-40 -140 V140" />
        <path d="M92 -128 L-20 0 L92 128" />
      </g>
    </svg>
  );
}
