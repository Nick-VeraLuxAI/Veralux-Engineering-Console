export class ModelProviderError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ModelProviderError";
    this.code = code;
  }
}
