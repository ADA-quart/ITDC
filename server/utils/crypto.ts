import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const DEFAULT_SECRET = 'smart-calendar-default-secret-key';

// 从环境变量派生密钥；若未设置 CRYPTO_SECRET 则使用默认值（仅适用于开发环境，生产环境务必设置环境变量）
function getKey(): Buffer {
  const secret = process.env.CRYPTO_SECRET;
  if (!secret || secret === DEFAULT_SECRET) {
    console.warn(
      '[安全警告] 未设置 CRYPTO_SECRET 环境变量或使用默认密钥。\n' +
      '  这意味着任何持有源码的人都能解密存储的 API Key。\n' +
      '  生产环境请务必通过环境变量 CRYPTO_SECRET 设置强密钥！'
    );
  }
  return scryptSync(secret || DEFAULT_SECRET, 'smart-calendar-salt', 32);
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // 格式: iv:authTag:ciphertext (均为 hex)
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decrypt(ciphertext: string): string {
  const key = getKey();
  const parts = ciphertext.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted format');
  }
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = Buffer.from(parts[2], 'hex');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted, undefined, 'utf8') + decipher.final('utf8');
}

export function isEncrypted(value: string): boolean {
  // 检查是否为加密格式 (iv:authTag:ciphertext，3个hex段)
  const parts = value.split(':');
  return parts.length === 3 && parts.every(p => /^[0-9a-f]+$/i.test(p));
}
