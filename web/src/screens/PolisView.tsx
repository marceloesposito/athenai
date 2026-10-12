// Una Polis: i suoi Oikos come carte, i membri come avatar. Tutto il resto in un pannello.
import { useState } from 'react';
import { ArrowLeft, Plus, Users } from 'lucide-react';
import { can } from '@athenai/protocol';
import { t, useLang } from '../i18n';
import { usePolis } from '../state/polis';
import { TopBar } from './Akropolis';
import { MembersDialog } from './MembersDialog';

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();

export function PolisView() {
  useLang();
  const { current, go, newOikos } = usePolis();
  const [members, setMembers] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  if (!current) return null;
  return (
    <div className="akropolis">
      <TopBar>
        <button className="icon-btn" aria-label={t('common.back')} onClick={() => void go({ kind: 'akropolis' })}>
          <ArrowLeft size={16} />
        </button>
        <span className="topbar__name">{current.name}</span>
      </TopBar>
      <main className="polis">
        <div className="polis__head">
          <button
            className="avatars"
            onClick={() => setMembers(true)}
            title={t('polis.members')}
          >
            {current.members.slice(0, 5).map((m) => (
              <span key={m.accountId} className="avatar avatar--small">
                {initials(m.name)}
              </span>
            ))}
            <span className="avatars__count">
              <Users size={14} /> {current.members.length}
            </span>
          </button>
        </div>
        <section className="cards" aria-label="Oikos">
          {current.oikos.map((o) => (
            <button key={o.id} className="card card--oikos" onClick={() => void go({ kind: 'oikos', id: current.id, oikosId: o.id })}>
              <strong className="card__title">{o.name}</strong>
              <span className="card__meta">Oikos</span>
            </button>
          ))}
          {can.write(current.role) &&
            (naming ? (
              <form
                className="card card--form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!name.trim()) return;
                  await newOikos(name);
                  setName('');
                  setNaming(false);
                }}
              >
                <input className="input" autoFocus placeholder={t('oikos.namePlaceholder')} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
                <div className="row">
                  <button type="button" className="btn" onClick={() => setNaming(false)}>
                    {t('common.cancel')}
                  </button>
                  <button type="submit" className="btn btn--primary" disabled={!name.trim()}>
                    {t('oikos.create')}
                  </button>
                </div>
              </form>
            ) : (
              <button className="card card--add" onClick={() => setNaming(true)}>
                <Plus size={18} /> {t('oikos.create')}
              </button>
            ))}
        </section>
        {current.oikos.length === 0 && <p className="hint">{t('oikos.empty')}</p>}
      </main>
      {members && <MembersDialog onClose={() => setMembers(false)} />}
    </div>
  );
}
