import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const NH_FIXTURE_PASSWORD = "000000"

export function readPdfFixture(name: string): Buffer {
  const fixtureDirectory = path.dirname(fileURLToPath(import.meta.url))
  return readFileSync(path.join(fixtureDirectory, name))
}
