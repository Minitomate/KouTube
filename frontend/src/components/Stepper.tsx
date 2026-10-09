import { useStore } from '../lib/store';

const LABELS = ['Paste', 'Customize', 'Download'];

export default function Stepper() {
  const { step } = useStore();
  return (
    <div className="stepper" role="list" aria-label="Progress">
      {LABELS.map((l, i) => (
        <div key={l} role="listitem" aria-current={step === i ? 'step' : undefined}
          className={`step${step >= i ? ' active' : ''}`} title={l} />
      ))}
    </div>
  );
}
