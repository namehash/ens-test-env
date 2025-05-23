import type { ConcurrentlyCommandInput } from 'concurrently'

/**
 * ens-test-env configuration object
 * @see [configuration documentation](https://github.com/ensdomains/ensjs-v3/tree/main/packages/ens-test-env/)
 */
export interface ENSTestEnvConfig {
  deployCommand?: string
  buildCommand?: string
  scripts?: (Exclude<ConcurrentlyCommandInput, string> & {
    finishOnExit?: boolean
  })[]
  paths?: {
    composeFile?: string
  }
}
