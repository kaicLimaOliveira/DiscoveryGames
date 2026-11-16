import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const OUTPUT_DIR = resolve(ROOT_DIR, '.output')
export const TEST_BUCKET = 'central-test'
export const TEST_ORIGIN = 'http://app.test'
