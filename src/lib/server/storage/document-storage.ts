import "server-only";
import { S3Client } from "@aws-sdk/client-s3";

export class DocumentStorageConfigurationError extends Error {
  constructor() {
    super("Document storage is not configured correctly.");
    this.name = "DocumentStorageConfigurationError";
  }
}

export function documentStorageConfig(
  env: Partial<NodeJS.ProcessEnv> = process.env,
) {
  const required = (name: string): string => {
    const value = env[name]?.trim();
    if (!value) throw new DocumentStorageConfigurationError();
    return value;
  };

  const bucket = required("BUCKET");
  const endpoint = required("ENDPOINT");
  const region = required("REGION");
  const accessKeyId = required("ACCESS_KEY_ID");
  const secretAccessKey = required("SECRET_ACCESS_KEY");

  // Require an explicit style so older buckets are not silently misconfigured.
  const style = required("DOCUMENT_STORAGE_URL_STYLE");
  if (style !== "virtual" && style !== "path") {
    throw new DocumentStorageConfigurationError();
  }

  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new DocumentStorageConfigurationError();
  }

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)
  ) {
    throw new DocumentStorageConfigurationError();
  }

  return {
    bucket,
    endpoint: url.origin,
    region,
    forcePathStyle: style === "path",
    credentials: { accessKeyId, secretAccessKey },
  };
}

// Internal backend client only. Never return configuration or credentials
// from an API. Upload/download services must authorise each document first.
export function createDocumentStorage(
  env: Partial<NodeJS.ProcessEnv> = process.env,
) {
  const { bucket, ...config } = documentStorageConfig(env);
  const client = new S3Client({
    ...config,
    maxAttempts: 1,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  return { bucket, client };
}
