/** Shared inline icons (no new dep): 24px, currentColor, decorative. */
export function Icon({ d, size = 20, fill = false }: { d: string; size?: number; fill?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false"
      fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'}
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

export const PATHS = {
  home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12a7 7 0 01-.1 1.2l2 1.6-2 3.4-2.4-1a7 7 0 01-2 1.2L14 20h-4l-.5-2.6a7 7 0 01-2-1.2l-2.4 1-2-3.4 2-1.6A7 7 0 015 12a7 7 0 01.1-1.2l-2-1.6 2-3.4 2.4 1a7 7 0 012-1.2L10 4h4l.5 2.6a7 7 0 012 1.2l2.4-1 2 3.4-2 1.6c.06.4.1.8.1 1.2z',
  sun: 'M12 17a5 5 0 100-10 5 5 0 000 10zM12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4l1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z',
  monitor: 'M4 5h16v11H4zM9 20h6M12 16v4',
  paste: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
  inspect: 'M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3',
  video: 'M4 8h12v8H4zM16 10l6-3v10l-6-3',
  audio: 'M4 10v4m4-7v10m4-13v16m4-13v10m4-7v4',
  captions: 'M4 6h16v12H4zM7 12h3m2 0h4M7 15h7',
  play: 'M8 5v14l11-7z',
  folder: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z',
  trash: 'M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m3 0l-1 13a1 1 0 01-1 1H8a1 1 0 01-1-1L6 7',
  clear: 'M6 6l12 12M18 6L6 18',
  alert: 'M12 3L2 21h20zM12 10v5m0 3v.5',
  download: 'M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 20h14',
  speed: 'M5 19a9 9 0 0114 0M12 15l3.5-5.5M12 15h.5',
  eta: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3.5 2',
};
