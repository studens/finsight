import "server-only"

import { Polar } from "@polar-sh/sdk"

import { PolarConfigError } from "./errors"

export function createPolarClient(): Polar {
  const accessToken = process.env.POLAR_ACCESS_TOKEN
  const server = process.env.POLAR_SERVER

  if (!accessToken) {
    throw new PolarConfigError("POLAR_ACCESS_TOKEN")
  }
  if (server !== "sandbox" && server !== "production") {
    throw new PolarConfigError("POLAR_SERVER")
  }

  return new Polar({ accessToken, server })
}
