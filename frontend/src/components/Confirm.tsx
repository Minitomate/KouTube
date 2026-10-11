interface Props {
  title: string;
  body?: string;
  items?: string[];
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Shared confirm modal (replaces native confirm for style + testability). */
export default function Confirm({ title, body, items, confirmLabel, onConfirm, onCancel }: Props) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="card modal"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{title}</h2>
        {body && <p>{body}</p>}
        {items && items.length > 0 && (
          <ul className="modal-list">
            {items.map((it) => <li key={it}>{it}</li>)}
          </ul>
        )}
        <div className="row">
          <button className="pill-btn filled" onClick={onConfirm}>{confirmLabel}</button>
          <button
            className="pill-btn outlined"
            onClick={onCancel}
            onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
