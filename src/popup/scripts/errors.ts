export class PropellerError extends Error {}

export class NotPropellerWebsiteError extends PropellerError {
  constructor(message?: string) {
    super(message);
    this.message = `Website loaded is not a propeller controlled domain: ${message}`;
  }

  message: string;
}

export type Errors = NotPropellerWebsiteError;
