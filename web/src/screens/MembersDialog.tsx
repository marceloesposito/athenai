// Membri della Polis: chi c'e' e con che ruolo; l'Archon invita (link per chi ha o crea un account),
// cambia i ruoli e allontana. Uscire dalla Polis e' possibile a tutti.
import { useState } from 'react';
import { UserMinus } from 'lucide-react';
import { can, MEMBER_ROLES, type MemberRole } from '@athenai/protocol';
import { t, useLang } from '../i18n';
import { useWork } from '../state/work';
import { Modal } from '../components/Modal';
import { CopyLink } from '../components/CopyLink';

export function MembersDialog({ onClose }: { onClose: () => void }) {
  useLang();
  const { polis, invite, setRole, removeMember } = useWork();
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!polis) return null;
  const archon = can.govern(polis.role);
  return (
    <Modal title={t('members.title')} onClose={onClose}>
      <ul className="people">
        {polis.members.map((m) => (
          <li key={m.id} className="people__row">
            <span className="avatar avatar--small">{(m.name[0] ?? '?').toUpperCase()}</span>
            <span className="people__name">
              {m.name}
              {m.me && <span className="hint"> · {t('members.you')}</span>}
            </span>
            {archon && !m.me ? (
              <select className="input input--small" value={m.role} onChange={(e) => void setRole(m.id, e.target.value as MemberRole)} aria-label={t('members.role')}>
                {MEMBER_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {t(`role.${r}`)}
                  </option>
                ))}
              </select>
            ) : (
              <span className="hint">{t(`role.${m.role}`)}</span>
            )}
            {(archon || m.me) && (
              <button className="icon-btn" title={m.me ? t('members.leave') : t('members.remove')} aria-label={m.me ? t('members.leave') : t('members.remove')} onClick={() => void removeMember(m.id)}>
                <UserMinus size={15} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {archon && (
        <section className="dialog-section">
          <h3>{t('members.invite')}</h3>
          <p className="hint">{t('members.inviteHint')}</p>
          {link ? (
            <CopyLink link={link} />
          ) : (
            <button
              className="btn btn--primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  setLink(await invite());
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t('members.createInvite')}
            </button>
          )}
        </section>
      )}
    </Modal>
  );
}
