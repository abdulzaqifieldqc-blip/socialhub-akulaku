import {
  S3Client, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from "node:crypto";

const required = ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"];
const configured = required.every(k => Boolean(process.env[k]));

export const s3 = configured ? new S3Client({
  region: process.env.S3_REGION || "auto",
  endpoint: process.env.S3_ENDPOINT || undefined,
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY
  }
}) : null;

export function safeMediaKey(userId, extension) {
  const cleanExt = String(extension || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
  return `users/${userId}/original/${Date.now()}-${crypto.randomUUID()}.${cleanExt || "bin"}`;
}

export async function createUploadUrl({ key, contentType, contentLength }) {
  if (!s3) throw new Error("Object storage belum dikonfigurasi.");
  const max = Number(process.env.MAX_UPLOAD_BYTES || 524288000);
  if (!Number.isInteger(contentLength) || contentLength < 1 || contentLength > max) {
    throw new Error(`Ukuran file harus antara 1 byte dan ${max} byte.`);
  }
  const command = new PutObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: key,
    ContentType: contentType,
    ContentLength: contentLength,
    Metadata: { retentiondays: String(process.env.MEDIA_RETENTION_DAYS || 7) }
  });
  return getSignedUrl(s3, command, {
    expiresIn: Number(process.env.UPLOAD_URL_TTL_SECONDS || 600)
  });
}

export async function verifyObject(key) {
  if (!s3) throw new Error("Object storage belum dikonfigurasi.");
  return s3.send(new HeadObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
}

export async function deleteObject(key) {
  if (!s3) throw new Error("Object storage belum dikonfigurasi.");
  return s3.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
}
