import concurrently from 'concurrently'
import compose from 'docker-compose'
import waitOn from 'wait-on'
import {
  awaitCommand,
  logContainers,
  rpcFetch,
  waitForENSNode,
} from './utils.js'

// ignore outputs from docker-compose if they contain any of these buffers, helpful for ignoring
// verbose logs (esp. from anvil during deploy script)
let outputsToIgnore = [
  Buffer.from('eth_getBlockByNumber'),
  Buffer.from('eth_getBlockByHash'),
  Buffer.from('eth_getTransactionReceipt'),
  Buffer.from('eth_blockNumber'),
  Buffer.from('eth_chainId'),
  Buffer.from('eth_getLogs'),
  Buffer.from('evm_snapshot'),
  Buffer.from('evm_revert'),
  Buffer.from('eth_call'),
  Buffer.from('eth_estimateGas'),
  Buffer.from('eth_feeHistory'),
  Buffer.from('eth_sendTransaction'),
]

// detects container exits in docker-compose logs
const exitedBuffers = [
  Buffer.from('exited with code 1'),
  Buffer.from('Error response from daemon:'),
]

let initialFinished = false
let cleanupRunning = false
/**
 * @type {import('docker-compose').IDockerComposeOptions}
 */
const opts = {
  log: true,
  composeOptions: ['-p', 'ens-test-env'],
}
let verbosity = 0

/**
 * @type {import('concurrently').Command[]}
 */
let commands
let options
/**
 * @type {import('./config.js').ENSTestEnvConfig}
 */
let config

/**
 *
 * @param {string | number} exitCode
 * @returns
 */
async function cleanup(exitCode) {
  let force = false
  if (cleanupRunning) {
    if (exitCode === 'SIGINT') {
      force = true
    } else {
      return
    }
  }
  cleanupRunning = true
  if (!force) console.log('Cleaning up...')
  else console.log('Forcing cleanup...')
  if (!options?.killGracefully || force || !initialFinished) {
    await compose
      .kill({
        ...opts,
        log: false,
      })
      .catch(() => console.error('kill failed'))
    if (force) return process.exit(exitCode ? 1 : 0)
    await compose
      .rm({
        ...opts,
        log: false,
      })
      .catch(() => console.error('rm failed'))
  } else {
    await compose
      .down({
        ...opts,
        log: false,
      })
      .then(() =>
        compose.rm({
          ...opts,
          log: false,
        }),
      )
      .catch(() => { })
  }

  commands?.forEach((command) => {
    try {
      process.kill(command.pid, 'SIGKILL')
    } catch { }
  })

  process.exit(exitCode ? 1 : 0)
}

async function waitForDir(
  container,
  dirPath,
  opts,
  timeout = 10000,
  interval = 500,
) {
  const start = Date.now()

  while (Date.now() - start < timeout) {
    try {
      const result = await compose.exec(
        container,
        ['test', '-d', dirPath],
        opts,
      )
      // exitCode 0 means the directory exists
      if (result.exitCode === 0) return true
    } catch {
      // ignore errors while waiting
    }
    await new Promise((r) => setTimeout(r, interval))
  }

  throw new Error(
    `Directory ${dirPath} did not appear in container ${container} within ${timeout}ms`,
  )
}

import path from 'node:path'

/**
 *
 * @param {string} container
 * @param {string} dirPath
 * @param {compose.IDockerComposeOptions} opts
 * @returns {Promise<Record<string, `0x${string}`>>}
 */
async function loadDeploymentAddresses(container, dirPath, opts) {
  try {
    // 1️⃣ List all JSON files in the directory
    const lsResult = await compose.exec(container, ['ls', dirPath], {
      ...opts,
      log: false,
    })
    const files = lsResult.out
      .split('\n')
      .map((f) => f.trim())
      .filter((f) => f.endsWith('.json'))

    /**
     * @type {Record<string, `0x${string}`>}
     */
    const addressMap = {}

    // 2️⃣ Read each JSON file
    for (const file of files) {
      const fullPath = path.posix.join(dirPath, file)

      const catResult = await compose.exec(container, ['cat', fullPath], {
        ...opts,
        log: false,
      })

      const json = JSON.parse(catResult.out)
      const name = path.basename(file, '.json') // strip extension

      if (json.address) {
        addressMap[name] = json.address
      }
    }

    opts.env = opts.env || {}
    opts.env.DEPLOYMENT_ADDRESSES = JSON.stringify(addressMap)
    opts.env.NEXT_PUBLIC_DEPLOYMENT_ADDRESSES = JSON.stringify(addressMap)
    process.env.DEPLOYMENT_ADDRESSES = JSON.stringify(addressMap)
    process.env.NEXT_PUBLIC_DEPLOYMENT_ADDRESSES = JSON.stringify(addressMap)

    // TODO: replace with actual legacy registry deployment
    opts.env.LegacyENSRegistry = '0x0000000000000000000000000000000000000000'
    process.env.LegacyENSRegistry = '0x0000000000000000000000000000000000000000'

    return addressMap
  } catch (err) {
    console.error('Failed to load deployment addresses:', err)
    throw err
  }
}

/**
 * @param {import('./config.js').ENSTestEnvConfig} _config
 * @param {*} _options
 * @param {boolean} [justKill]
 * @returns
 */
export const main = async (_config, _options, justKill) => {
  config = _config
  options = _options
  verbosity = Number.parseInt(options.verbosity)

  opts.cwd = config.paths.composeFile.split('/docker-compose.yml')[0]
  opts.env = { ...process.env }

  // if verbosity is high enough
  if (verbosity >= 2) {
    // unset outputsToIgnore (log everything)
    outputsToIgnore = []
    // enforce anvil tracing logs
    opts.env.ANVIL_EXTRA_ARGS = '--tracing'
  } else {
    // silence 'variable is not set' warning
    opts.env.ANVIL_EXTRA_ARGS = ''
  }

  if (justKill) return cleanup('SIGINT')

  // log the config we're using
  if (verbosity >= 1) console.log({ config, options })

  const inxsToFinishOnExit = []
  const cmdsToRun = (config.scripts || []).map(
    ({ finishOnExit, ...script }, i) => {
      finishOnExit && inxsToFinishOnExit.push(i)
      return script
    },
  )

  // start anvil & wait for rpc
  console.log('Starting devnet...')
  await compose.upOne('devnet', opts)
  logContainers(
    ['devnet'],
    cleanup,
    {
      ...opts,
      env: {
        ...opts.env,
        DEPLOYMENT_ADDRESSES: process.env.DEPLOYMENT_ADDRESSES,
        NEXT_PUBLIC_DEPLOYMENT_ADDRESSES:
          process.env.NEXT_PUBLIC_DEPLOYMENT_ADDRESSES,
      },
    },
    exitedBuffers,
    outputsToIgnore,
    verbosity,
  )
  await waitOn({ resources: ['tcp:localhost:8545'] })

  console.log('Waiting for L1 contracts to deploy')
  await waitForDir('devnet', 'deployments/l1-local', opts)
  console.log('Waiting for L2 contracts to deploy')
  await waitForDir('devnet', 'deployments/l2-local', opts)
  console.log('↳ done.')

  await loadDeploymentAddresses('devnet', 'deployments/l1-local', opts)

  // bail if cleaning up
  if (cleanupRunning) return

  // set block timestamp
  if (options.extraTime) {
    const timestamp =
      Math.floor(Date.now() / 1000) - Number.parseInt(options.extraTime)
    console.log('\x1b[1;34m[config]\x1b[0m ', 'setting timestamp to', timestamp)
    // set next block timestamp relative to current time
    await rpcFetch('anvil_setNextBlockTimestamp', [timestamp])
  } else {
    // set next block timestamp to ensure consistent hashes
    await rpcFetch('anvil_setNextBlockTimestamp', [1640995200])
  }

  // set block timestamp interval before deploy (necessary for deploy to succeed)
  await rpcFetch('anvil_setBlockTimestampInterval', [1])

  // wait for deploy
  if (config.deployCommand) {
    console.log('Running deploy script...')
    await awaitCommand('deploy', config.deployCommand, verbosity)
    console.log('↳ done.')
  }

  // remove block timestamp interval after deploy (necessary for some tests to pass)
  await rpcFetch('anvil_removeBlockTimestampInterval', [])

  // if exiting after deploy, cleanup here
  if (options.exitAfterDeploy) {
    console.log(
      '\x1b[1;34m[config]\x1b[0m ',
      'Exiting after contract deployment...',
    )
    return cleanup(0)
  }

  // TODO: can we run this logic every time?
  // set to current time
  if (options.extraTime) {
    await rpcFetch('evm_snapshot', [])
    // set to current time
    await rpcFetch('anvil_setNextBlockTimestamp', [
      Math.floor(Date.now() / 1000),
    ])

    // manually mine block
    // NOTE: this was originally required for graph-node to register an update but in this fork
    // we use ENSNode, which doesn't have this requirement. that said, this line must remain,
    // because otherwise tests fail (not sure why)
    await rpcFetch('evm_mine', [])
  }

  // snapshot (necesssary so tests can easily reset to this point)
  await rpcFetch('evm_snapshot', [])

  // if there's a build command, run it
  if (config.buildCommand && options.build) {
    console.log('Running build command...')
    await awaitCommand('build', config.buildCommand, verbosity)
    console.log('↳ done.')
  }

  initialFinished = true

  if (cleanupRunning) return

  if (options.ensnode) {
    console.log('Starting ENSNode...')
    // start ENSNode containers (dependencies also starts ensrainbow and postgres)
    await compose.upOne('ensindexer', opts)
    logContainers(
      ['ensindexer', 'ensrainbow', 'postgres'],
      cleanup,
      opts,
      exitedBuffers,
      outputsToIgnore,
      verbosity,
    )
    console.log('↳ done.')

    // wait for it to index to present
    const { result } = await rpcFetch('eth_blockNumber', [])
    const blockheight = Number.parseInt(result.slice(2), 16)
    console.log(`Waiting for ENSNode to index to block ${blockheight}...`)
    await waitForENSNode(blockheight, verbosity)
    console.log('↳ done.')
  }

  // run commands if specified
  if (options.scripts && cmdsToRun.length > 0) {
    console.log('Running scripts...')

    /**
     * @type {import('concurrently').ConcurrentlyResult['result']}
     */
    let result
      ; ({ commands, result } = concurrently(cmdsToRun, {
        prefix: 'name',
      }))

    commands.forEach((cmd) => {
      if (inxsToFinishOnExit.includes(cmd.index)) {
        cmd.close.subscribe(({ exitCode }) => cleanup(exitCode))
      } else {
        cmd.close.subscribe(
          ({ exitCode }) => exitCode === 0 || cleanup(exitCode),
        )
      }
    })

    result.catch(cleanup.bind(null, { exit: true }))
  }
}

// do something when app is closing
process.on('exit', cleanup.bind(null, { cleanup: true }))

// catches ctrl+c event
process.on('SIGINT', cleanup.bind(null, { exit: true }))
