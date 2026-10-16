// La Polis: i suoi Symposia (i progetti) e chi ne fa parte. Una sola azione principale per l'Archon:
// "Nuovo Symposion".
import { useState } from 'react';
import { Plus, Users } from 'lucide-react';
import { can } from '@athenai/protocol';
import { t, useLang } from '../i18n';
import { useWork } from '../state/work';
import { MembersDialog } from './MembersDialog';

export function Home() {
  useLang();
  const { polis, go, newSymposion } = useWork();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [members, setMembers] = useState(false);
  if (!polis) return null;
  const archon = can.govern(polis.role);
  return (
    <main className="home">
      <header className="home__head">
        <div>
          <h1 className="home__title">{polis.name}</h1>
          <p className="hint">{t(`role.${polis.role}.long`)}</p>
        </div>
        <button className="btn" onClick={() => setMembers(true)}>
          <Users size={15} /> {t('members.title')} · {polis.members.length}
        </button>
      </header>
      <section className="cards" aria-label="Symposia">
        {polis.symposia.map((s) => (
          <button key={s.id} className="card" onClick={() => void go({ kind: 'symposion', symposionId: s.id, section: 'grapheion', documentId: null })}>
            <strong className="card__title">{s.name}</strong>
            <span className="card__meta">Symposion</span>
          </button>
        ))}
        {archon &&
          (naming ? (
            <form
              className="card card--form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!name.trim()) return;
                await newSymposion(name);
                setName('');
                setNaming(false);
              }}
            >
              <input className="input" autoFocus placeholder={t('symposion.namePlaceholder')} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
              <div className="row">
                <button type="button" className="btn" onClick={() => setNaming(false)}>
                  {t('common.cancel')}
                </button>
                <button type="submit" className="btn btn--primary" disabled={!name.trim()}>
                  {t('common.create')}
                </button>
              </div>
            </form>
          ) : (
            <button className="card card--add" onClick={() => setNaming(true)}>
              <Plus size={18} /> {t('symposion.new')}
            </button>
          ))}
      </section>
      {!polis.symposia.length && <p className="hint">{t(archon ? 'symposion.emptyArchon' : 'symposion.empty')}</p>}
      {members && <MembersDialog onClose={() => setMembers(false)} />}
    </main>
  );
}
