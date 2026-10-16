// Condividi un Symposion. Con chi non ha un account: un link privato ("puo' modificare" o "puo'
// commentare"); chi lo apre entra per una sessione con il nome di un personaggio greco. Con chi
// deve restare: l'invito nella Polis (membri).
import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { GuestMode } from '@athenai/protocol';
import { t, useLang, getLang } from '../i18n';
import { useWork } from '../state/work';
import { Modal } from '../components/Modal';
import { CopyLink } from '../components/CopyLink';
import { MembersDialog } from './MembersDialog';

export function ShareDialog({ symposionId, onClose }: { symposionId: string; onClose: () => void }) {
  useLang();
  const { polis, createGuestLink, revokeGuestLink } = useWork();
  const [mode, setMode] = useState<GuestMode>('edit');
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [members, setMembers] = useState(false);
  if (!polis) return null;
  const name = polis.symposia.find((s) => s.id === symposionId)?.name ?? '';
  const links = polis.detail.links.filter((l) => l.symposionId === symposionId);
  const guests = polis.detail.guests.filter((g) => g.symposionId === symposionId);
  const fmt = new Intl.DateTimeFormat(getLang(), { day: 'numeric', month: 'short' });
  if (members) return <MembersDialog onClose={onClose} />;
  return (
    <Modal title={t('share.title', { name })} onClose={onClose}>
      <section className="dialog-section">
        <h3>{t('share.guests')}</h3>
        <p className="hint">{t('share.guestsHint')}</p>
        <div className="seg-group" role="radiogroup" aria-label={t('share.mode')}>
          {(['edit', 'comment'] as GuestMode[]).map((m) => (
            <button key={m} role="radio" aria-checked={mode === m} className={`seg ${mode === m ? 'is-on' : ''}`} onClick={() => (setMode(m), setLink(null))}>
              {t(`share.mode.${m}`)}
            </button>
          ))}
        </div>
        {link ? (
          <CopyLink link={link} />
        ) : (
          <button
            className="btn btn--primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                setLink(await createGuestLink(symposionId, mode));
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('share.createLink')}
          </button>
        )}
        {!!links.length && (
          <ul className="people">
            {links.map((l) => (
              <li key={l.id} className="people__row">
                <span className="people__name">{t(`share.mode.${l.mode}`)}</span>
                <span className="hint">{t('share.until', { date: fmt.format(new Date(l.expiresAt)) })}</span>
                <button className="icon-btn" title={t('share.revoke')} aria-label={t('share.revoke')} onClick={() => void revokeGuestLink(l.id)}>
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {!!guests.length && (
          <p className="hint">
            {t('share.present')}: {guests.map((g) => g.name).join(', ')}
          </p>
        )}
      </section>
      <section className="dialog-section">
        <h3>{t('share.members')}</h3>
        <p className="hint">{t('share.membersHint')}</p>
        <button className="btn" onClick={() => setMembers(true)}>
          {t('members.title')}
        </button>
      </section>
    </Modal>
  );
}
