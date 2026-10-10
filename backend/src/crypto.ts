import crypto from 'node:crypto';
import { config } from './config';

/**
 * 纯加密工具（不依赖数据库）：密码哈希 + JWT 签发/校验
 *
 * 密码：scrypt（Node 内置，无需原生依赖），格式为 scrypt$<saltHex>$<hashHex>
 * Token：HS256 JWT（Node 内置 HMAC，无需 jsonwebtoken 依赖）
 */

// ============ 密码 ============

const SCRYPT_KEYLEN = 64;

/** 生成密码哈希（内含随机盐，同一密码两次结果不同） */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/** 校验密码（恒定时间比较，防时序攻击） */
export function verifyPassword(password: string, stored: string): boolean {
  const [alg, saltHex, hashHex] = stored.split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  try {
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length || SCRYPT_KEYLEN);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

// ============ JWT（HS256）============

export interface TokenPayload {
  uid: string;
  username: string;
  iat: number;
  exp: number;
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

function sign(data: string): string {
  return crypto.createHmac('sha256', config.authSecret).update(data).digest('base64url');
}

/** 签发 token，默认 7 天有效 */
export function signToken(user: { id: string; username: string }, ttlSeconds = 7 * 24 * 3600): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload: TokenPayload = {
    uid: user.id,
    username: user.username,
    iat: now,
    exp: now + ttlSeconds,
  };
  const body = b64url(JSON.stringify(payload));
  return `${header}.${body}.${sign(`${header}.${body}`)}`;
}

/** 校验 token，失败返回 null（过期 / 签名不符 / 格式错误） */
export function verifyToken(token: string): TokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, body, signature] = parts;
  const expected = sign(`${header}.${body}`);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload;
    if (!payload?.uid || typeof payload.exp !== 'number') return null;
    if (payload.exp * 1000 < Date.now()) return null; // 已过期
    return payload;
  } catch {
    return null;
  }
}

/** 生成随机令牌（找回密码用，明文只出现一次，库里存哈希） */
export function generateToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

// ============ 敏感信息加密（用户 API Key 落库）============

const ENC_PREFIX = 'enc:v1:';

function deriveEncKey(): Buffer {
  // 用 AUTH_SECRET 派生对称密钥（换密钥会导致已存 Key 无法解密，属预期行为）
  return crypto.scryptSync(config.authSecret, 'dasheng-api-key', 32);
}

/** AES-256-GCM 加密，格式为 enc:v1:<iv>.<tag>.<ciphertext>（均 base64url） */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveEncKey(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return (
    ENC_PREFIX +
    [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.')
  );
}

/** 解密；格式不符或密钥变更时返回 null */
export function decryptSecret(stored: string): string | null {
  if (!stored) return null;
  if (!stored.startsWith(ENC_PREFIX)) return stored; // 兼容早期明文
  try {
    const [ivB64, tagB64, dataB64] = stored.slice(ENC_PREFIX.length).split('.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', deriveEncKey(), Buffer.from(ivB64, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    const data = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64url')), decipher.final()]);
    return data.toString('utf8');
  } catch {
    return null;
  }
}

/** 脱敏展示：sk-12******3456 */
export function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '****';
  return `${value.slice(0, 6)}****${value.slice(-4)}`;
}
