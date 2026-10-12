// Invito arrivato da un link: si propone dopo lo sblocco, con il nome della Polis (decifrato qui).
import { useEffect, useState } from 'react';
import type { Role } from '@athenai/protocol';
import { t } from '../i18n';
import { usePolis } from '../state/polis';

export function InviteBanner() {
  const { pendingInvite, previewPending, acceptPending, dismissInvite } = usePolis();
  const [info, setInfo] = useState<{ name: string; role: Role } | null | 'invalid'>(null);
  useEffect(() => {
    if (pendingInvite) void previewPending().then((r) => setInfo(r ?? 'invalid'));
  }, [pendingInvite, previewPending]);
  if (!pendingInvite || !info) return null;
  return (
    <div className="banner" role="status">
      {info === 'invalid' ? (
        <>
          <span>{t('invite.invalid')}</span>
          <button className="btn" onClick={dismissInvite}>
            {t('common.close')}
          </button>
        </>
      ) : (
        <>
          <span>{t('invite.offer', { name: info.name, role: t(`role.${info.role}`) })}</span>
          <div className="row">
            <button className="btn" onClick={dismissInvite}>
              {t('invite.decline')}
            </button>
            <button
              className="btn btn--primary"
              onClick={async () => {
                if ((await acceptPending()) === 'invalid') setInfo('invalid');
              }}
            >
              {t('invite.accept')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
