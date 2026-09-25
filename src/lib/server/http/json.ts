import "server-only";

export class JsonRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "JsonRequestError";
  }
}

export function jsonNoStore(
  body: unknown,
  status: number = 200,
): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function readBoundedJson(
  request: Request,
  maxBytes: number = 4096,
): Promise<unknown> {
  const contentType = request.headers
    .get("content-type")
    ?.split(";")[0]
    .trim()
    .toLowerCase();

  if (contentType !== "application/json") {
    throw new JsonRequestError(
      "Send the request as application/json.",
      415,
    );
  }

  if (!request.body) {
    throw new JsonRequestError("Request body is required.", 400);
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { value, done } = await reader.read();

      if (done) break;

      totalBytes += value.byteLength;

      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new JsonRequestError("Request body is too large.", 413);
      }

      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof JsonRequestError) throw error;

    throw new JsonRequestError("Unable to read request body.", 400);
  } finally {
    reader.releaseLock();
  }

  try {
    return JSON.parse(
      Buffer.concat(chunks).toString("utf8"),
    ) as unknown;
  } catch {
    throw new JsonRequestError(
      "Request body must contain valid JSON.",
      400,
    );
  }
}
