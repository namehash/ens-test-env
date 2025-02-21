#!/usr/bin/env node

/* eslint-disable */

import path from 'node:path'
import { emitKeypressEvents } from 'node:readline'
import { Command, Option } from 'commander'
import { main as manager } from './manager.js'

/**
 * @type {import('./config').ENSTestEnvConfig}
 */
let config
const program = new Command()

const __dirname = new URL('.', import.meta.url).pathname
const cwd = process.cwd()

program
  .name('ens-test-env')
  .description('A testing environment for everything ENS')
  .version(process.env.npm_package_version || '0.1.0')
  .option('-c, --config <path>', 'Specify config directory')
  .option('-a, --always-cleanup', 'Always cleanup after running')
  .hook('preAction', async () => {
    if (program.optsWithGlobals().alwaysCleanup) {
      emitKeypressEvents(process.stdin)
      if (process.stdin.isTTY) process.stdin.setRawMode(true)
      process.stdin.on('keypress', (_char, key) => {
        if (key.ctrl && key.name === 'c') {
          process.kill(process.pid, 'SIGINT')
        }
      })
    }
    // if config arg supplied, get config path as next arg
    const configDir = program.optsWithGlobals().config
    // if config arg, try load config
    if (configDir) {
      try {
        config = (await import(path.join(process.cwd(), configDir))).default
      } catch {
        program.error(`Config file ${configDir} not found`)
      }
    } else {
      config = (
        await import(path.join(process.cwd(), 'ens-test-env.config.js'))
      ).default
    }
    // if config doesn't have all data, throw error
    if (!config) {
      program.error('No valid config found')
      return program.help()
    }
    // add default paths to config, and let them be replaced by specified vars
    const paths = {
      composeFile: path.resolve(__dirname, './docker-compose.yml'),
    }
    const configPaths = config.paths || {}
    for (const [key, value] of Object.entries(configPaths)) {
      if (typeof value === 'string') {
        paths[key] = path.resolve(cwd, value)
      }
    }
    config.paths = paths
  })

program
  .command('start')
  .description('Starts the test environment')
  .addOption(
    new Option(
      '--extra-time <time>',
      'Sets the relative extra time for deploys',
    ).conflicts('save'),
  )
  .addOption(new Option('--no-ensnode', "Don't start ENSNode"))
  .addOption(new Option('-k, --kill-gracefully', 'Kill gracefully'))
  .addOption(new Option('--no-build', "Don't run the build command"))
  .addOption(new Option('--no-scripts', "Don't run the scripts"))
  .addOption(
    new Option('--verbosity <level>', 'Verbose output level (0-2').default(0),
  )
  .addOption(new Option('--exit-after-deploy', 'Exit after deploying'))
  .action(async (options) => {
    await manager(config, options)
  })

program
  .command('kill')
  .description('Forcefully kills the test environment')
  .action(async () => {
    await manager(config, {}, true)
  })

program.parse(process.argv)
