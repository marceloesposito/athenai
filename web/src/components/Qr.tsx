// QR del codice di collegamento, disegnato in locale (nessun servizio esterno).
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export function Qr({ text, size = 220 }: { text: string; size?: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void QRCode.toDataURL(text, { margin: 1, width: size, errorCorrectionLevel: 'M' }).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [text, size]);
  return url ? <img className="qr" src={url} width={size} height={size} alt="" /> : <div className="qr" style={{ width: size, height: size }} />;
}
