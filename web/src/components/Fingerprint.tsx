import { useEffect, useState } from 'react';
import { fingerprint, type PublicIdentity } from '../crypto/keys';

export function Fingerprint({ identity }: { identity: PublicIdentity }) {
  const [fp, setFp] = useState('');
  useEffect(() => {
    void fingerprint(identity).then(setFp);
  }, [identity]);
  return <code className="fingerprint">{fp}</code>;
}
