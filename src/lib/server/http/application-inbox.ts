import "server-only";
import { HttpError } from "@/lib/server/http";
import { jsonNoStore } from "@/lib/server/http/json";
import { ResidentRequestError } from "@/lib/server/services/resident-requests.service";
import { SocietyAccessError } from "@/lib/server/services/society-access.service";

export function applicationInboxFailure(error: unknown) {
  if (error instanceof HttpError || error instanceof ResidentRequestError) {
    return jsonNoStore({ message: error.message }, error.status);
  }
  if (error instanceof SocietyAccessError) {
    return jsonNoStore({ message: error.message }, 403);
  }
  if (typeof error === "object" && error !== null &&
      "code" in error && error.code === "23505") {
    return jsonNoStore({
      message: "This application or membership changed. Refresh before continuing.",
    }, 409);
  }
  const diagnostic = error as {
    name?: unknown;
    code?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  } | null;

  const safeCode = (value: unknown) =>
    typeof value === "string" && /^[A-Za-z0-9_]{1,64}$/.test(value)
      ? value
      : undefined;

  console.error("Application operation failed", {
    name: safeCode(diagnostic?.name),
    code: safeCode(diagnostic?.code),
    httpStatus:
      typeof diagnostic?.$metadata?.httpStatusCode === "number"
        ? diagnostic.$metadata.httpStatusCode
        : undefined,
  });

  if (diagnostic?.name === "DocumentStorageConfigurationError") {
    return jsonNoStore({
      message: "Document storage is not configured correctly. Your application remains saved.",
    }, 503);
  }
  return jsonNoStore({
    message: "The result could not be confirmed. Refresh to check the current status.",
  }, 503);
}

export function applicationInboxFilters(params: URLSearchParams) {
  return {
    page: params.get("page") ?? "1",
    status: params.get("status") ?? "all",
    ...(params.get("application") ? { application: params.get("application") } : {}),
  };
}
