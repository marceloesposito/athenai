import { describe, expect, it } from 'vitest';
import { can, isRole, inviteLink, parseInviteLink, isSealedBox, isUuid, isB64url, authMessage, registerMessage } from './index';

describe('ruoli', () => {
  it('solo l\'Archon governa; Mentore e Xenos non scrivono; Xenos non commenta', () => {
    expect(can.govern('archon')).toBe(true);
    expect(can.govern('polites')).toBe(false);
    expect(can.write('polites')).toBe(true);
    expect(can.write('mentore')).toBe(false);
    expect(can.comment('mentore')).toBe(true);
    expect(can.comment('xenos')).toBe(false);
    expect(isRole('kritès')).toBe(false);
  });
});

describe('link d\'invito', () => {
  const id = '7f9c2b1e-3a4d-4e5f-8a6b-1c2d3e4f5a6b';
  it('andata e ritorno; il segreto sta solo nel frammento', () => {
    const link = inviteLink('https://athenai.example/', id, 'S3cr3t_s3cr3t-s3cr3t_x');
    expect(link).toBe(`https://athenai.example/invito/${id}#S3cr3t_s3cr3t-s3cr3t_x`);
    expect(new URL(link).pathname).not.toContain('S3cr3t');
    expect(parseInviteLink(link)).toEqual({ inviteId: id, secret: 'S3cr3t_s3cr3t-s3cr3t_x' });
  });
  it('link non validi', () => {
    expect(parseInviteLink(`https://x/invito/${id}`)).toBeNull();
    expect(parseInviteLink(`https://x/invito/not-a-uuid-0000-0000-0000-000000000000#abcdefghijklmnopqrstu`)).toBeNull();
  });
});

describe('validazione', () => {
  it('buste, uuid, base64url', () => {
    expect(isSealedBox({ v: 1, e: 1, n: 'abc', c: 'def' })).toBe(true);
    expect(isSealedBox({ v: 1, e: 0, n: 'abc', c: 'def' })).toBe(false);
    expect(isSealedBox({ v: 1, e: 1, n: 'a+b', c: 'def' })).toBe(false);
    expect(isUuid('7f9c2b1e-3a4d-4e5f-8a6b-1c2d3e4f5a6b')).toBe(true);
    expect(isUuid('7F9C2B1E-3A4D-4E5F-8A6B-1C2D3E4F5A6B')).toBe(false);
    expect(isB64url('a'.repeat(10), 5)).toBe(false);
  });
  it('testi firmati distinti per scopo', () => {
    expect(authMessage('x')).not.toBe(registerMessage('x', 'y', 'z'));
  });
});
