export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function readBytes(
  request: Request,
  limit: number,
): Promise<Buffer> {
  if (Number(request.headers.get("content-length") || 0) > limit)
    throw new ApiError(413, "Request body too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "Request body required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new ApiError(413, "Request body too large.");
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally {
    reader.releaseLock();
  }
}

export async function readJson(
  request: Request,
  limit = 128 * 1024,
): Promise<unknown> {
  if (
    request.headers.get("content-type")?.split(";")[0].trim() !==
    "application/json"
  )
    throw new ApiError(415, "Expected application/json.");
  const origin = request.headers.get("origin");
  if (
    origin &&
    origin !== (process.env.APP_ORIGIN || new URL(request.url).origin)
  )
    throw new ApiError(403, "Origin not allowed.");
  const bytes = await readBytes(request, limit);
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new ApiError(400, "Malformed JSON.");
  }
}
