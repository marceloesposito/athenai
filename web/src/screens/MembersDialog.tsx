// Membri della Polis: chi c'e', con che ruolo, l'impronta di ciascuno; l'Archon invita e governa.
import { useState } from 'react';
import { Copy, Check, UserMinus } from 'lucide-react';
import { can, ROLES, type Role } from '@athenai/protocol';
import { t, useLang } from '../i18n';
import { usePolis } from '../state/polis';
import { Modal } from '../components/Modal';
import { Fingerprint } from '../components/Fingerprint';

type InviteRole = Exclude<Role, 'archon'>;

export function MembersDialog({ onClose }: { onClose: () => void }) {
  useLang();
  const { current, invite, setRole, remove } = usePolis();
  const [role, setInviteRole] = useState<InviteRole>('polites');
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  if (!current) return null;
  const govern = can.govern(current.role);
  return (
    <Modal title={t('polis.members')} onClose={onClose}>
      <ul className="members">
        {current.members.map((m) => (
          <li key={m.accountId} className="member">
            <button className="member__main" onClick={() => setOpen(open === m.accountId ? null : m.accountId)}>
              <span>
                {m.name}
                {m.me && <span className="hint"> · {t('polis.you')}</span>}
              </span>
              {govern && !m.me ? (
                <select className="input input--small" value={m.role} onClick={(e) => e.stopPropagation()} onChange={(e) => void setRole(m.accountId, e.target.value as Role)}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {t(`role.${r}`)}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="hint">{t(`role.${m.role}`)}</span>
              )}
            </button>
            {open === m.accountId && (
              <div className="member__more">
                <small className="hint">{t('symbolon.fingerprint')}</small>
                <Fingerprint identity={{ sign: m.signPk, box: m.boxPk }} />
                {(govern || m.me) && (
                  <button className="btn btn--danger" onClick={() => void remove(m.accountId)}>
                    <UserMinus size={14} /> {m.me ? t('polis.leave') : t('polis.remove')}
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {govern && (
        <div className="invite">
          <h3>{t('invite.title')}</h3>
          <div className="seg-group" role="radiogroup" aria-label={t('invite.role')}>
            {(['polites', 'mentore', 'xenos'] as InviteRole[]).map((r) => (
              <button key={r} role="radio" aria-checked={role === r} className={`seg ${role === r ? 'is-on' : ''}`} onClick={() => setInviteRole(r)}>
                {t(`role.${r}`)}
              </button>
            ))}
          </div>
          <p className="hint">{t(`role.${role}.hint`)}</p>
          {link ? (
            <>
              <div className="row row--start">
                <code className="code">{link}</code>
                <button
                  className="icon-btn"
                  aria-label={t('common.copy')}
                  onClick={async () => {
                    await navigator.clipboard.writeText(link);
                    setCopied(true);
                  }}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
              <p className="hint">{t('invite.linkHint')}</p>
            </>
          ) : (
            <button
              className="btn btn--primary"
              onClick={async () => {
                setLink(await invite(role));
                setCopied(false);
              }}
            >
              {t('invite.create')}
            </button>
          )}
        </div>
      )}
    </Modal>
  );
}
