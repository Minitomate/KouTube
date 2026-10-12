/** Single-option toggle: button role=switch with sliding thumb. */
export default function Switch({ checked, onChange, label }: {
  checked: boolean; onChange: () => void; label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      className="switch"
      onClick={onChange}
    >
      <span className="switch-thumb" aria-hidden="true" />
      <span className="switch-text">{label}</span>
    </button>
  );
}
