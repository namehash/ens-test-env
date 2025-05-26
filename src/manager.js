/* eslint-disable */
import { spawn } from 'node:child_process'
import { Transform } from 'node:stream'
import concurrently from 'concurrently'
import compose from 'docker-compose'
import dotenv from 'dotenv'
import waitOn from 'wait-on'
import { rpcFetch } from './utils.js'

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
      .catch(() => {})
  }

  commands?.forEach((command) => {
    try {
      process.kill(command.pid, 'SIGKILL')
    } catch {}
  })

  process.exit(exitCode ? 1 : 0)
}
/**
 * @param {string | Buffer} prefix
 * @returns
 */
const makePrepender = (prefix) =>
  new Transform({
    transform(chunk, _, done) {
      // @ts-expect-error
      this._rest = this._rest?.length
        ? // @ts-expect-error
          Buffer.concat([this._rest, chunk])
        : chunk

      let index

      // As long as we keep finding newlines, keep making slices of the buffer and push them to the
      // readable side of the transform stream
      // @ts-expect-error
      while ((index = this._rest.indexOf('\n')) !== -1) {
        // The `end` parameter is non-inclusive, so increase it to include the newline we found
        // @ts-expect-error
        const line = this._rest.slice(0, ++index)
        // `start` is inclusive, but we are already one char ahead of the newline -> all good
        // @ts-expect-error
        this._rest = this._rest.slice(index)
        // We have a single line here! Prepend the string we want
        this.push(Buffer.concat([prefix, line]))
      }

      return void done()
    },

    // Called before the end of the input so we can handle any remaining
    // data that we have saved
    flush(done) {
      // If we have any remaining data in the cache, send it out

      // @ts-expect-error
      if (this._rest?.length) {
        // @ts-expect-error
        return void done(null, Buffer.concat([prefix, this._rest]))
      }
    },
  })

/**
 * @param {string} name
 * @param {*} command
 * @returns
 */
const awaitCommand = async (name, command) => {
  const allArgs = command.split(' ')
  const deploy = spawn(allArgs.shift(), allArgs, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'pipe',
    shell: true,
  })
  const outPrepender = makePrepender(Buffer.from(`\x1b[1;34m[${name}]\x1b[0m `))
  const errPrepender = makePrepender(Buffer.from(`\x1b[1;34m[${name}]\x1b[0m `))
  if (verbosity > 0) {
    deploy.stdout.pipe(outPrepender).pipe(process.stdout)
  }
  deploy.stderr.pipe(errPrepender).pipe(process.stderr)
  return new Promise((resolve) => deploy.on('exit', () => resolve()))
}

/**
 * logs containers by name, starting cleanup if they exit
 * @param {string[]} names
 */
const logContainers = async (names) => {
  compose
    .logs(names, {
      ...opts,
      log: false,
      follow: true,
      callback: (chunk, source) => {
        // check for exit buffer(s)
        if (exitedBuffers.some((b) => chunk.includes(b))) return cleanup(1)

        // forward stderr
        if (source === 'stderr') return process.stderr.write(chunk)

        // ignore log if verbosity 0
        if (verbosity === 0) return

        // ignore any output that matches 'ignoreOutput' buffers
        const ignoreOutput = outputsToIgnore.some((ignoreBuffer) =>
          chunk.includes(ignoreBuffer),
        )
        if (ignoreOutput) return

        // forward stdout
        return process.stdout.write(chunk)
      },
    })
    .catch((e) => {
      console.error(e)
      cleanup(1)
    })
}

/**
 * @param {number} blockheight
 */
const waitForENSNode = async (blockheight) => {
  // wait for server to be available
  await waitOn({ resources: ['http://localhost:42069'] })

  let currentBlockheight = 0
  // getter for current indexed blockheight
  const getCurrentBlock = async () =>
    // TODO: once _meta is available on subgraph-compat schema (/subgraph), use that
    fetch('http://localhost:42069/ponder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ _meta { status } }', variables: {} }),
    })
      .then((res) => res.json())
      .then((res) => {
        if (res.errors) throw new Error(JSON.stringify(res.errors))
        const blockNumber = res.data._meta.status['1337'].block?.number
        if (!blockNumber) return 0
        return blockNumber
      })
      .catch((error) => {
        console.error(error)
        return 0
      })

  // wait for indexer to reach blockNumber
  while (currentBlockheight < blockheight) {
    currentBlockheight = await getCurrentBlock()
    if (verbosity >= 1) {
      console.log(
        `ENSNode at blockheight: ${currentBlockheight}, need ${blockheight}`,
      )
    }

    // sleep
    await new Promise((resolve) => setTimeout(resolve, 500))
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
  console.log('Starting anvil...')
  await compose.upOne('anvil', opts)
  logContainers(['anvil'])
  await waitOn({ resources: ['tcp:localhost:8545'] })
  console.log('↳ done.')

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
  console.log('Running deploy script...')
  await awaitCommand('deploy', config.deployCommand)
  console.log('↳ done.')

  // source .env.local
  dotenv.config({ path: `${process.cwd()}/.env.local`, debug: true })
  // load into docker compose opts again
  opts.env = { ...process.env }

  if (
    !process.env.DEPLOYMENT_ADDRESSES &&
    !process.env.NEXT_PUBLIC_DEPLOYMENT_ADDRESSES
  ) {
    console.error(
      'process.env.[NEXT_PUBLIC_]DEPLOYMENT_ADDRESSES is not available, ENSNode is unable to index.',
    )
    return cleanup(1)
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
    await awaitCommand('build', config.buildCommand)
    console.log('↳ done.')
  }

  initialFinished = true

  if (cleanupRunning) return

  if (options.ensnode) {
    console.log('Starting ENSNode...')
    // start ENSNode containers (dependencies also starts ensrainbow and postgres)
    await compose.upOne('ensindexer', opts)
    logContainers(['ensindexer', 'ensrainbow', 'postgres'])
    console.log('↳ done.')

    // wait for it to index to present
    const { result } = await rpcFetch('eth_blockNumber', [])
    const blockheight = Number.parseInt(result.slice(2), 16)
    console.log(`Waiting for ENSNode to index to block ${blockheight}...`)
    await waitForENSNode(blockheight)
    console.log('↳ done.')
  }

  // run commands if specified
  if (options.scripts && cmdsToRun.length > 0) {
    console.log('Running scripts...')

    /**
     * @type {import('concurrently').ConcurrentlyResult['result']}
     */
    let result
    ;({ commands, result } = concurrently(cmdsToRun, {
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
