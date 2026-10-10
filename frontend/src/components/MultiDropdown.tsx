import { useEffect, useRef, useState } from 'react';

export interface MultiOption {
  id: string;
  label: string;
  badge?: string;
}

interface Props {
  label: string;
  options: MultiOption[];
  selected: string[];
  onToggle: (id: string) => void;
  emptyText: string;
  summaryNone: string;
}

/** Shared multi-select dropdown (audio tracks, captions). */
export default function MultiDropdown({ label, options, selected, onToggle, emptyText, summaryNone }: Props) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const buttonId = `md-${label.replace(/\W+/g, '-').toLowerCase()}`;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open ]);
  const summary = selected.length === 0
    ? summaryNone
    : selected.length === 1
      ? (options.find((o) => o.id === selected[0])?.label ?? selected[0])
      : `${selected.length} selected`;
  return (
    <div className="field" ref={boxRef}>
      <span id={buttonId}>{label}</span>
      <button
        type="button"
        className="select-pill md-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={buttonId}
        onClick={() => setOpen((v) => !v)}
      >
        {summary}
      </button>
      {open && (
        <div className="md-panel" role="listbox" aria-label={label} aria-multiselectable="true">
          {options.length === 0 && <p className="empty">{emptyText}</p>}
          {options.map((o) => {
            const on = selected.includes(o.id);
            return (
              <div
                key={o.id}
                role="option"
                aria-selected={on}
                tabIndex={0}
                className="md-option"
                onClick={() => onToggle(o.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onToggle(o.id);
                  }
                }}
              >
                <input type="checkbox" tabIndex={-1} checked={on} readOnly aria-hidden="true" />
                <span>{o.label}</span>
                {o.badge && <span className="badge">{o.badge}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
