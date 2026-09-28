import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const endpoint = process.env.R2_ENDPOINT;
const accessKeyId = process.env.R2_ACCESS_KEY_ID ?? '';
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY ?? '';
const bucket = process.env.R2_BUCKET ?? 'cutforge';

const client = endpoint && accessKeyId
  ? new S3Client({ region: 'auto', endpoint, credentials: { accessKeyId, secretAccessKey } })
  : null;

export const hasR2 = () => client !== null;

export async function presignPut(key: string, contentType: string): Promise<{ url: string; key: string }> {
  if (!client) return { url: '', key };
  const url = await getSignedUrl(client, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }), { expiresIn: 600 });
  return { url, key };
}

export function publicUrl(key: string): string {
  const base = process.env.R2_PUBLIC_BASE;
  return base ? `${base}/${key}` : '';
}
