import { useEffect, useState } from 'react';
import { getAppVersion } from '../lib/updater';

/** App credit line: name, build version, creator. Shared by Home + Settings. */
export default function Footer() {
  const [version, setVersion] = useState('…');
  useEffect(() => {
    getAppVersion().then(setVersion).catch(() => setVersion('unknown'));
  }, []);
  return (
    <div className="footer meta" role="contentinfo">
      KouTube {version} · by Minitomate
    </div>
  );
}
