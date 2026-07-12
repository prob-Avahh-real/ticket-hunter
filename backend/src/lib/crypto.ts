import crypto from "crypto";

const ENC_KEY = Buffer.from((process.env.ENCRYPTION_KEY || "dev-32-byte-key!!!!change-me!!").slice(0, 32), "utf8");
const ENC_ALGO = "aes-256-gcm";
const ID_SALT = process.env.ID_SALT || "dev-id-salt-change-me";

export function encrypt(text: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ENC_ALGO, ENC_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

export function decrypt(ciphertext: string): string | null {
  try {
    const [ivB64, tagB64, dataB64] = ciphertext.split(".");
    if (!ivB64 || !tagB64 || !dataB64) return null;
    const iv = Buffer.from(ivB64, "base64");
    const tag = Buffer.from(tagB64, "base64");
    const encrypted = Buffer.from(dataB64, "base64");
    const decipher = crypto.createDecipheriv(ENC_ALGO, ENC_KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch { return null; }
}

export function hashIdCard(idCard: string): string {
  return crypto.createHmac("sha256", ID_SALT).update(idCard).digest("hex");
}

export function maskPhone(phone: string): string {
  if (!phone || phone.length < 11) return phone || "";
  return phone.replace(/(\d{3})\d{4}(\d{4})/, "$1****$2");
}

export function maskIdCard(idCard: string): string {
  if (!idCard || idCard.length < 18) return idCard || "";
  return idCard.replace(/(\d{6})\d{8}(\d{4})/, "$1********$2");
}

export function maskName(name: string): string {
  if (!name) return "";
  if (name.length === 1) return "*";
  if (name.length === 2) return name[0] + "*";
  return name[0] + "*" + name.slice(-1);
}
