import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import logger from '../logger.js';

// ── Configuration ────────────────────────────────────────────────────
// Tigris (S3-compatible) credentials are set as Fly secrets:
//   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_ENDPOINT_URL_S3,
//   BUCKET_NAME, AWS_REGION

const bucket = process.env.BUCKET_NAME ?? 'bullem-images';
const region = process.env.AWS_REGION ?? 'auto';
const endpoint = process.env.AWS_ENDPOINT_URL_S3;

const s3 = new S3Client({
  region,
  endpoint,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
  },
});

/**
 * Build the public URL for an object in the bucket.
 * Tigris exposes public objects at `https://<bucket>.fly.storage.tigris.dev/<key>`.
 */
function publicUrl(key: string): string {
  return `https://${bucket}.fly.storage.tigris.dev/${key}`;
}

/**
 * Upload an image buffer to Tigris and return the public URL.
 *
 * @param key   Object key (e.g. `avatars/<userId>.webp`)
 * @param body  Image buffer
 * @param contentType  MIME type (e.g. `image/webp`)
 */
export async function uploadImage(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<string> {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );

  const url = publicUrl(key);
  logger.info({ key, bucket }, 'Uploaded image to Tigris');
  return url;
}

/**
 * Delete an image from Tigris by key.
 * Silently succeeds if the object does not exist.
 */
export async function deleteImage(key: string): Promise<void> {
  try {
    await s3.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    );
    logger.info({ key, bucket }, 'Deleted image from Tigris');
  } catch (err) {
    logger.warn({ err, key, bucket }, 'Failed to delete image from Tigris');
  }
}

/**
 * Extract the object key from a Tigris public URL.
 * Returns null if the URL doesn't match the expected pattern.
 */
export function keyFromUrl(url: string): string | null {
  const prefix = `https://${bucket}.fly.storage.tigris.dev/`;
  if (url.startsWith(prefix)) {
    return url.slice(prefix.length);
  }
  return null;
}
