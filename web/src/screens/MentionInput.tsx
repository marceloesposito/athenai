// Campo di testo degli Scholia con le @menzioni: scrivendo "@" compaiono i membri della Polis.
import { useMemo, useRef, useState } from 'react';
import { fuzzyFilter } from 'logos/lib/fuzzy';
import { mentionQuery, completeMention, type Mentionable } from '../grapheion/scholia';

interface Props {
  value: string;
  onChange(v: string): void;
  onSubmit(): void;
  onCancel?(): void;
  people: Mentionable[];
  placeholder: string;
  autoFocus?: boolean;
}

export function MentionInput({ value, onChange, onSubmit, onCancel, people, placeholder, autoFocus }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const [pick, setPick] = useState(0);
  const [closed, setClosed] = useState<number | null>(null);
  const q = mentionQuery(value, caret);
  const options = useMemo(() => (q ? fuzzyFilter(people, q.query, (p) => p.name, 6) : []), [q?.query, people]);
  const open = !!q && options.length > 0 && closed !== q.start;

  const choose = (p: Mentionable) => {
    if (!q) return;
    const next = completeMention(value, q.start, caret, p.name);
    onChange(next.text);
    setCaret(next.caret);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(next.caret, next.caret);
    });
  };

  return (
    <div className="mention">
      <textarea
        ref={ref}
        className="input mention__input"
        rows={2}
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setCaret(e.target.selectionStart);
          setPick(0);
        }}
        onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart)}
        onKeyDown={(e) => {
          if (open) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              setPick((pick + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length);
              return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault();
              choose(options[pick] ?? options[0]);
              return;
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              setClosed(q!.start);
              return;
            }
          }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onSubmit();
          } else if (e.key === 'Escape' && onCancel) onCancel();
        }}
      />
      {open && (
        <ul className="menu mention__menu" role="listbox">
          {options.map((p, i) => (
            <li key={p.accountId}>
              <button
                type="button"
                role="option"
                aria-selected={i === pick}
                className={`menu__item ${i === pick ? 'is-on' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(p);
                }}
              >
                @{p.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
