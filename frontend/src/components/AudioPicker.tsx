import { useStore } from '../lib/store';

export default function AudioPicker() {
  const { audioTrack, set, media } = useStore();
  const tracks = media?.audioTracks ?? [];
  return (
    <div className="card">
      <h2>Audio track</h2>
      <label className="sr" htmlFor="audiotrack">Audio track</label>
      <select
        id="audiotrack"
        className="select-pill"
        value={audioTrack}
        onChange={(e) => set({ audioTrack: e.target.value })}
      >
        <option value="original">Original</option>
        {tracks.map((t) => (
          <option key={t.id} value={t.id}>{t.label}</option>
        ))}
      </select>
    </div>
  );
}
