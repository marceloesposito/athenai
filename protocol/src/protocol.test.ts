import { describe, expect, it } from 'vitest';
import {
  can,
  canPush,
  isRole,
  isMemberRole,
  inviteLink,
  parseInviteLink,
  guestLink,
  parseGuestLink,
  isSealedBox,
  isUuid,
  isB64url,
  isEmail,
  isKdfParams,
  normalizeEmail,
  authMessage,
  registerMessage,
  logMessage,
  parseClientMessage,
  noticeMessage,
  pickGuestName,
  GUEST_NAMES,
  AD,
} from './index';

describe('ruoli', () => {
  it('solo l\'Archon governa; i Politai scrivono; gli Xenoi scrivono solo con il link "modifica"', () => {
    expect(can.govern('archon')).toBe(true);
    expect(can.govern('polites')).toBe(false);
    expect(can.write('polites')).toBe(true);
    expect(can.write('xenos', 'edit')).toBe(true);
    expect(can.write('xenos', 'comment')).toBe(false);
    expect(can.write('xenos')).toBe(false);
    expect(canPush('xenos', 'scholia', 'comment')).toBe(true);
    expect(canPush('xenos', 'text', 'comment')).toBe(false);
    expect(isRole('mentore')).toBe(false);
    expect(isMemberRole('xenos')).toBe(false);
  });
});

describe('link', () => {
  const id = '7f9c2b1e-3a4d-4e5f-8a6b-1c2d3e4f5a6b';
  it('invito e link ospite: andata e ritorno; il segreto sta solo nel frammento', () => {
    const link = inviteLink('https://athenai.example/', id, 'S3cr3t_s3cr3t-s3cr3t_x');
    expect(link).toBe(`https://athenai.example/invito/${id}#S3cr3t_s3cr3t-s3cr3t_x`);
    expect(new URL(link).pathname).not.toContain('S3cr3t');
    expect(parseInviteLink(link)).toEqual({ inviteId: id, secret: 'S3cr3t_s3cr3t-s3cr3t_x' });
    const g = guestLink('https://athenai.example', id, 'S3cr3t_s3cr3t-s3cr3t_x');
    expect(parseGuestLink(g)).toEqual({ linkId: id, secret: 'S3cr3t_s3cr3t-s3cr3t_x' });
    expect(parseGuestLink(link)).toBeNull();
  });
  it('link non validi', () => {
    expect(parseInviteLink(`https://x/invito/${id}`)).toBeNull();
    expect(parseInviteLink(`https://x/invito/not-a-uuid-0000-0000-0000-000000000000#abcdefghijklmnopqrstu`)).toBeNull();
  });
});

describe('nomi degli ospiti', () => {
  it('diversi da quelli presenti; poi con il numero romano', () => {
    let i = 0;
    const rand = () => ((i += 0.37) % 1);
    const taken = new Set<string>();
    for (let k = 0; k < GUEST_NAMES.length; k++) {
      const n = pickGuestName(taken, rand);
      expect(taken.has(n)).toBe(false);
      taken.add(n);
    }
    expect(taken.size).toBe(GUEST_NAMES.length);
    expect(pickGuestName(taken, () => 0)).toBe('Saffo II');
  });
});

describe('validazione', () => {
  it('buste, uuid, base64url, email, parametri della password', () => {
    expect(isSealedBox({ v: 1, e: 1, n: 'abc', c: 'def' })).toBe(true);
    expect(isSealedBox({ v: 1, e: 0, n: 'abc', c: 'def' })).toBe(false);
    expect(isSealedBox({ v: 1, e: 1, n: 'a+b', c: 'def' })).toBe(false);
    expect(isUuid('7f9c2b1e-3a4d-4e5f-8a6b-1c2d3e4f5a6b')).toBe(true);
    expect(isUuid('7F9C2B1E-3A4D-4E5F-8A6B-1C2D3E4F5A6B')).toBe(false);
    expect(isB64url('a'.repeat(10), 5)).toBe(false);
    expect(isEmail('saffo@lesbo.gr')).toBe(true);
    expect(isEmail('saffo@lesbo')).toBe(false);
    expect(normalizeEmail('  Saffo@Lesbo.GR ')).toBe('saffo@lesbo.gr');
    expect(isKdfParams({ salt: 'abcd', ops: 3, mem: 64 * 1024 * 1024 })).toBe(true);
    // parametri troppo deboli o troppo pesanti: rifiutati
    expect(isKdfParams({ salt: 'abcd', ops: 1, mem: 64 * 1024 * 1024 })).toBe(false);
    expect(isKdfParams({ salt: 'abcd', ops: 3, mem: 1024 })).toBe(false);
  });
  it('testi firmati distinti per scopo; l\'email nella firma e\' normalizzata', () => {
    expect(authMessage('x')).not.toBe(registerMessage('x', 'y', 'z@a.b'));
    expect(registerMessage('a', 'b', 'Z@A.B')).toBe(registerMessage('a', 'b', 'z@a.b'));
    expect(AD.masterWrap('password')).not.toBe(AD.masterWrap('recovery'));
  });
});

describe('documenti e tempo reale', () => {
  const documentId = '7f9c2b1e-3a4d-4e5f-8a6b-1c2d3e4f5a6b';
  const box = { v: 1 as const, e: 2, n: 'nonce', c: 'testo' };

  it('la firma copre flusso, tipo, epoca e contenuto', () => {
    const a = logMessage(documentId, 'text', 'update', box);
    expect(a).not.toBe(logMessage(documentId, 'scholia', 'update', box));
    expect(a).not.toBe(logMessage(documentId, 'text', 'snapshot', box));
    expect(a).not.toBe(logMessage(documentId, 'text', 'update', { ...box, e: 3 }));
    expect(AD.docLog(documentId, 'text', 'update', 'a')).not.toBe(AD.docLog(documentId, 'text', 'update', 'b'));
  });

  it('messaggi del client: validi e non validi', () => {
    const push = { t: 'push', ref: 1, documentId, stream: 'text', kind: 'update', box, sig: 'firma' };
    expect(parseClientMessage(JSON.stringify(push))).toEqual(push);
    expect(parseClientMessage(JSON.stringify({ ...push, kind: 'snapshot' }))).toBeNull(); // manca covers
    expect(parseClientMessage(JSON.stringify({ ...push, kind: 'snapshot', covers: 4 }))).toMatchObject({ covers: 4 });
    expect(parseClientMessage(JSON.stringify({ ...push, covers: 4 }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ ...push, stream: 'altro' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'sub', documentId: 'x' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'aw', documentId, box: null }))).toEqual({ t: 'aw', documentId, box: null });
    expect(parseClientMessage('non json')).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'boh' }))).toBeNull();
  });

  it('notifiche: la firma e\' legata al destinatario', () => {
    expect(noticeMessage('a', 'x')).not.toBe(noticeMessage('b', 'x'));
  });
});
