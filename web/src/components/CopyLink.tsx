// Un link da copiare: il campo in sola lettura e il pulsante "Copia".
import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { t } from '../i18n';

export function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-link">
      <input className="input copy-link__input" readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label={t('common.link')} />
      <button
        className="btn"
        onClick={async () => {
          await navigator.clipboard.writeText(link).catch(() => undefined);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? t('common.copied') : t('common.copy')}
      </button>
    </div>
  );
}
