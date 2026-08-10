export class PolarConfigError extends Error {
  readonly code = "POLAR_CONFIG_ERROR" as const

  constructor(variableName: string) {
    super(`${variableName} is required`)
    this.name = "PolarConfigError"
  }
}

export class PolarWebhookVerificationError extends Error {
  readonly code = "POLAR_WEBHOOK_INVALID_SIGNATURE" as const

  constructor() {
    super("Polar webhook signature verification failed")
    this.name = "PolarWebhookVerificationError"
  }
}

export class PolarApiError extends Error {
  readonly code = "POLAR_API_ERROR" as const

  constructor(message: string) {
    super(message)
    this.name = "PolarApiError"
  }
}
