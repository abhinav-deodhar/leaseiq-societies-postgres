import "server-only";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function checkRequestOrigin(request: Request): void {
  const allowedOrigin = process.env.APP_ORIGIN;

  if (!allowedOrigin) {
    throw new HttpError(503, "Application origin is not configured.");
  }

  const origin = request.headers.get("origin");

  if (origin && origin !== allowedOrigin) {
    throw new HttpError(403, "Request origin is not permitted.");
  }
}

export async function readJsonBody(
  request: Request,
  maximumBytes = 16384,
): Promise<unknown> {
  const contentType = request.headers
    .get("content-type")
    ?.split(";")[0]
    .trim()
    .toLowerCase();

  if (contentType !== "application/json") {
    throw new HttpError(415, "Send the request as application/json.");
  }

  if (!request.body) {
    throw new HttpError(400, "Request body is required.");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      size += value.byteLength;

      if (size > maximumBytes) {
        await reader.cancel();
        throw new HttpError(413, "Request body is too large.");
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Request body must contain valid JSON.");
  }
}