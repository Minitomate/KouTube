import { useEffect, useState } from 'react';
import { getAppVersion } from '../lib/updater';
import { useLocale } from '../lib/store';

/** App credit line: name, build version, creator. Shared by Home + Settings. */
export default function Footer() {
  const { t } = useLocale();
  const [version, setVersion] = useState('…');
  useEffect(() => {
    getAppVersion().then(setVersion).catch(() => setVersion(t('foot.unknown')));
  }, [t]);
  return (
    <div className="footer meta" role="contentinfo">
      {t('foot.line', { v: version })}
    </div>
  );
}
