export class AuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigurationError";
  }
}

export class ClaimUnavailableError extends Error {
  constructor() {
    super("This claim link is unavailable.");
    this.name = "ClaimUnavailableError";
  }
}

export class JoinUnavailableError extends Error {
  constructor(message = "This trip invitation is unavailable.") {
    super(message);
    this.name = "JoinUnavailableError";
  }
}

export class MembershipDisabledError extends Error {
  constructor() {
    super("This trip membership is disabled.");
    this.name = "MembershipDisabledError";
  }
}

export class SessionUnavailableError extends Error {
  constructor(message = "This session is unavailable.") {
    super(message);
    this.name = "SessionUnavailableError";
  }
}

export class RateLimitError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super("Too many authentication attempts.");
    this.name = "RateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
