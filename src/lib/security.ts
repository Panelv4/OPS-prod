import crypto from "crypto";
import { isIP } from "node:net";
import { vaultMaterial } from "./config";
import bcrypt from "bcryptjs";

const BCRYPT_ROUNDS = 10;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function validatePasswordStrength(password: string): string | null {
  if (Buffer.byteLength(password, "utf8") > 72)
    return "Password must not exceed 72 UTF-8 bytes.";
  if (password.length < 8) {
    return "Password must be at least 8 characters long.";
  }
  if (
    !/[A-Z]/.test(password) ||
    !/[a-z]/.test(password) ||
    !/[0-9]/.test(password)
  ) {
    return "Password must contain uppercase, lowercase, and numeric characters.";
  }
  return null;
}

export function generateSecureToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("hex");
}

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function getEncryptionKey(): Buffer {
  const raw = vaultMaterial();
  return crypto.createHash("sha256").update(`opspilot-aes:${raw}`).digest();
}

export function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptSecret(payload: string): string | null {
  try {
    const parts = payload.split(":");
    if (parts.length !== 3) return null;
    const [ivHex, tagHex, dataHex] = parts;
    const key = getEncryptionKey();
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(ivHex, "hex"),
    );
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataHex, "hex")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch {
    return null;
  }
}

export function sanitizeText(value: string): string {
  return value.replace(/\u0000/g, "").trim();
}

const ALLOWED_UPLOAD_MIMES = new Set([
  "application/pdf",
  "text/plain",
  "text/csv",
  "text/markdown",
  "application/json",
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const BLOCKED_EXTENSIONS = new Set([
  ".exe",
  ".sh",
  ".bat",
  ".cmd",
  ".js",
  ".mjs",
  ".html",
  ".htm",
  ".svg",
  ".php",
  ".py",
  ".jar",
]);

export const MAX_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export function validateUploadFile(params: {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  bytes?: Buffer;
}): { valid: boolean; error?: string; safeFileName: string } {
  const safeFileName = params.fileName
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 140);

  if (!safeFileName) {
    return { valid: false, error: "Invalid file name.", safeFileName: "file" };
  }

  const lower = safeFileName.toLowerCase();
  for (const ext of BLOCKED_EXTENSIONS) {
    if (lower.endsWith(ext)) {
      return {
        valid: false,
        error: `File extension ${ext} is blocked for security reasons.`,
        safeFileName,
      };
    }
  }

  const extensions: Record<string, string[]> = {
    "application/pdf": ["pdf"],
    "text/plain": ["txt"],
    "text/csv": ["csv"],
    "text/markdown": ["md", "markdown"],
    "application/json": ["json"],
    "image/png": ["png"],
    "image/jpeg": ["jpeg", "jpg"],
    "image/webp": ["webp"],
    "application/msword": ["doc"],
    "application/vnd.ms-excel": ["xls"],
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
      "docx",
    ],
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [
      "xlsx",
    ],
  };
  if (!extensions[params.mimeType]?.includes(lower.split(".").pop() || ""))
    return {
      valid: false,
      error: "File extension does not match the allowed MIME type.",
      safeFileName,
    };
  if (params.bytes) {
    const b = params.bytes;
    const prefix = b.subarray(0, 12).toString("hex");
    const sig: Record<string, string> = {
      pdf: "255044462d",
      png: "89504e470d0a1a0a",
      jpg: "ffd8ff",
      jpeg: "ffd8ff",
      docx: "504b0304",
      xlsx: "504b0304",
      doc: "d0cf11e0a1b11ae1",
      xls: "d0cf11e0a1b11ae1",
    };
    const ext = lower.split(".").pop()!;
    if (
      (sig[ext] && !prefix.startsWith(sig[ext])) ||
      (ext === "webp" &&
        !(
          b.toString("ascii", 0, 4) === "RIFF" &&
          b.toString("ascii", 8, 12) === "WEBP"
        )) ||
      ((params.mimeType.startsWith("text/") || ext === "json") && b.includes(0))
    )
      return {
        valid: false,
        error: "File contents do not match the declared type.",
        safeFileName,
      };
  }
  if (!ALLOWED_UPLOAD_MIMES.has(params.mimeType)) {
    return {
      valid: false,
      error: `File type ${params.mimeType} is not allowed. Upload PDF, PNG, JPEG, CSV, TXT, Markdown, DOCX, or XLSX.`,
      safeFileName,
    };
  }

  if (params.sizeBytes <= 0 || params.sizeBytes > MAX_UPLOAD_SIZE_BYTES) {
    return {
      valid: false,
      error: "File size must be between 1 byte and 5 MB.",
      safeFileName,
    };
  }

  return { valid: true, safeFileName };
}

export function verifyCsrf(
  request: Request,
  sessionCsrfToken: string,
): boolean {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return true;
  }
  const headerToken = request.headers.get("x-csrf-token");
  if (headerToken) {
    try {
      const a = Buffer.from(headerToken);
      const b = Buffer.from(sessionCsrfToken);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }
  return false;
}

// Only enable behind an ingress which strips and replaces X-Real-IP. Never trust a client-supplied chain.
export function getClientIp(request: Request): string {
  const ip = request.headers.get("x-real-ip") || "";
  return process.env.TRUST_PROXY === "1" && isIP(ip) ? ip : "unknown";
}
