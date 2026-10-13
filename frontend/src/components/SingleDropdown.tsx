import { useEffect, useRef, useState } from 'react';

export interface SingleOption {
  id: string;
  label: string;
}

interface Props {
  label: string;
  options: SingleOption[];
  value: string;
  onChange: (id: string) => void;
}

/** Single-select dropdown: same trigger/panel/option language as the
 *  multi-select, so native selects (unstylable open popups) are gone. */
export default function SingleDropdown({ label, options, value, onChange }: Props) {
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
  const current = options.find((o) => o.id === value)?.label ?? value;
  function pick(id: string) {
    onChange(id);
    setOpen(false);
  }
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
        {current}
      </button>
      {open && (
        <div className="md-panel" role="listbox" aria-label={label}>
          {options.map((o) => {
            const on = o.id === value;
            return (
              <div
                key={o.id}
                role="option"
                aria-selected={on}
                tabIndex={0}
                className="md-option"
                onClick={() => pick(o.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    pick(o.id);
                  }
                }}
              >
                <span>{o.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
