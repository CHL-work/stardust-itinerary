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

/** The operator suspended this account (JOB-069): no sign-in and no session until it is lifted. */
export class AccountSuspendedError extends Error {
  constructor() {
    super("This account is suspended.");
    this.name = "AccountSuspendedError";
  }
}

/** Today's cap on new public sign-ups is reached, or the operator paused them (JOB-069). */
export class SignupPausedError extends Error {
  constructor() {
    super("New sign-ups are paused for today.");
    this.name = "SignupPausedError";
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
