export class ApplicationError extends Error {
  constructor(
    readonly code: "FORBIDDEN" | "APPLICATION_EXISTS",
    message: string,
  ) {
    super(message);
    this.name = "ApplicationError";
  }
}