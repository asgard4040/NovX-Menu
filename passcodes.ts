import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt } from 'node:crypto';

export const isPasscode = (value: unknown): value is string => typeof value === 'string' && /^[0-9]{4}$/.test(value);
export const isWeakPasscode = (code: string): boolean => /^([0-9])\1{3}$/.test(code) ||
  ['0123', '1234', '2345', '3456', '4567', '5678', '6789', '9876', '8765', '7654', '6543', '5432', '4321', '3210', '1212', '2580'].includes(code);

export function passcodeKey(secret: string): Buffer {
  if (!/^[a-f0-9]{64}$/i.test(secret)) throw new Error('passcode_secret_not_configured');
  return createHash('sha256').update(Buffer.from(secret, 'hex')).digest();
}

export function passcodeDigest(code: string, key: Buffer): string {
  if (!isPasscode(code)) throw new Error('invalid_passcode');
  return createHmac('sha256', key).update(`lookup:${code}`).digest('hex');
}

export function encryptPasscode(code: string, key: Buffer): string {
  if (!isPasscode(code)) throw new Error('invalid_passcode');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(code, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.');
}

export function decryptPasscode(value: string, key: Buffer): string {
  const parts = value.split('.');
  if (parts.length !== 3) throw new Error('invalid_passcode_record');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parts[0], 'base64url'));
  decipher.setAuthTag(Buffer.from(parts[1], 'base64url'));
  const code = Buffer.concat([decipher.update(Buffer.from(parts[2], 'base64url')), decipher.final()]).toString('utf8');
  if (!isPasscode(code)) throw new Error('invalid_passcode_record');
  return code;
}

export function generatePasscode(): string {
  let code: string;
  do { code = randomInt(0, 10_000).toString().padStart(4, '0'); } while (isWeakPasscode(code));
  return code;
}
