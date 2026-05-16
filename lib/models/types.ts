/**
 * Structured error for model providers so API routes can map to HTTP status.
 */
export class ModelProviderError extends Error {
  constructor(
    message: string,
    public readonly status: number = 502,
  ) {
    super(message);
    this.name = "ModelProviderError";
  }
}

export function isModelProviderError(
  err: unknown,
): err is ModelProviderError {
  return err instanceof ModelProviderError;
}
