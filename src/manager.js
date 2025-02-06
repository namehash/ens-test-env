/* eslint-disable */
import { spawn } from 'node:child_process'
import { Transform } from 'node:stream'
import concurrently from 'concurrently'
import compose from 'docker-compose'
import waitOn from 'wait-on'
import { main as fetchData } from './fetch-data.js'

let outputsToIgnore = [
  Buffer.from('eth_getBlockByNumber'),
  Buffer.from('eth_getBlockByHash'),
  Buffer.from('eth_getTransactionReceipt'),
]

const exitedBuffer = Buffer.from('exited with code 1')

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

const getCompose = async () => {
  const version = await compose.version().catch(() => null)
  if (version) return compose

  throw new Error('No docker-compose found, or docker not running?')
}

/**
 * @type {import('concurrently').Command[]}
 * */
let commands
let options
/**
 * @type {import('./config').ENSTestEnvConfig}
 */
let config

/**
 *
 * @param {object[]} items
 * @returns
 */
const batchRpcFetch = (items) =>
  fetch('http://localhost:8545', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(
      items.map((item, i) => ({ jsonrpc: '2.0', id: i + 1, ...item })),
    ),
  }).then((res) => res.json())

/**
 *
 * @param {string} method
 * @param {*} params
 * @returns
 */
const rpcFetch = (method, params) =>
  batchRpcFetch([{ method, params }]).then((res) => res[0])

async function cleanup(_, exitCode) {
  const compose = await getCompose()
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
    if (options.save) {
      await fetchData('compress', config)
    }
  }

  commands?.forEach((command) => {
    try {
      process.kill(command.pid, 'SIGKILL')
    } catch {}
  })

  process.exit(exitCode ? 1 : 0)
}
/**
 *
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
      if (this._rest?.length)
        // @ts-expect-error
        return void done(null, Buffer.concat([prefix, this._rest]))
    },
  })

/**
 *
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
 *
 * @param {import('./config').ENSTestEnvConfig} _config
 * @param {*} _options
 * @param {boolean} [justKill]
 * @returns
 */
export const main = async (_config, _options, justKill) => {
  config = _config
  options = _options
  verbosity = Number.parseInt(options.verbosity)

  console.log(config, options)

  opts.cwd = config.paths.composeFile.split('/docker-compose.yml')[0]

  opts.env = {
    ...process.env,
    DATA_FOLDER: config.paths.data,
    ANVIL_EXTRA_ARGS: '',
    BLOCK_TIMESTAMP: Math.floor(new Date().getTime() / 1000).toString(),
  }

  if (justKill) {
    return cleanup(undefined, 'SIGINT')
  }

  if (options.verbosity >= 2) {
    outputsToIgnore = []
    opts.env.ANVIL_EXTRA_ARGS = '--tracing'
  }

  const compose = await getCompose()

  try {
    await compose.upOne('anvil', opts)
  } catch (e) {
    console.error('e: ', e)
  }

  compose
    .logs(['anvil', 'graph-node', 'postgres', 'ipfs', 'metadata'], {
      ...opts,
      log: false,
      follow: verbosity > 0,
      callback: (chunk, source) => {
        if (source === 'stderr') {
          process.stderr.write(chunk)
        } else {
          for (let i = 0; i < outputsToIgnore.length; i++) {
            if (chunk.includes(outputsToIgnore[i])) return
          }
          if (chunk.includes(exitedBuffer)) {
            cleanup(
              undefined,
              Number.parseInt(chunk.toString().split('exited with code ')[1]),
            )
            return
          }
          process.stdout.write(chunk)
        }
      },
    })
    .catch(() => {})

  const inxsToFinishOnExit = []
  const cmdsToRun = (config.scripts || []).map(
    ({ finishOnExit, ...script }, i) => {
      finishOnExit && inxsToFinishOnExit.push(i)
      return script
    },
  )

  if (cleanupRunning) return

  await waitOn({ resources: ['tcp:localhost:8545'] })

  // wait 1000 ms to make sure the server is up
  await new Promise((resolve) => setTimeout(resolve, 1000))

  if (!options.save) {
    if (!options.extraTime) {
      // set next block timestamp to ensure consistent hashes
      await rpcFetch('anvil_setNextBlockTimestamp', [1640995200])
    } else {
      const timestamp =
        Math.floor(Date.now() / 1000) - Number.parseInt(options.extraTime)
      console.log(
        '\x1b[1;34m[config]\x1b[0m ',
        'setting timestamp to',
        timestamp,
      )
      // set next block timestamp relative to current time
      await rpcFetch('anvil_setNextBlockTimestamp', [timestamp])
    }

    await rpcFetch('anvil_setBlockTimestampInterval', [1])

    await awaitCommand('deploy', config.deployCommand)

    // remove block timestamp interval after deploy
    await rpcFetch('anvil_removeBlockTimestampInterval', [])

    if (options.exitAfterDeploy) {
      console.log(
        '\x1b[1;34m[config]\x1b[0m ',
        'Exiting after contract deployment...',
      )
      return cleanup(undefined, 0)
    }

    if (options.extraTime) {
      // snapshot before setting current time
      await rpcFetch('evm_snapshot', [])
      // set to current time
      await rpcFetch('anvil_setNextBlockTimestamp', [
        Math.floor(Date.now() / 1000),
      ])
      // mine block for graph node to update
      await rpcFetch('evm_mine', [])
      // snapshot after setting current time
      await rpcFetch('evm_snapshot', [])
    }

    if (config.buildCommand && options.build) {
      await awaitCommand('build', config.buildCommand)
    }
  }

  initialFinished = true

  if (cleanupRunning) return

  if (options.graph) {
    try {
      await compose.upAll(opts)
    } catch {}

    await waitOn({ resources: ['http://localhost:42069'] })
  }

  if (!options.save && cmdsToRun.length > 0 && options.scripts) {
    if (options.graph) {
      const indexArray = []
      const getCurrentIndex = async () =>
        // TODO: once _meta is available on subgraph-compat schema, use that
        fetch('http://localhost:42069', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query: `{ _meta { status } }`,
            variables: {},
          }),
        })
          .then((res) => res.json())
          .then((res) => {
            if (res.errors) {
              console.error(res.errors)
              return 0
            }
            const blockNumber = res.data._meta.status['1337'].block?.number;
            if (!blockNumber) throw new Error(`not ready`)
            console.log(`ENSNode at ${blockNumber}`)
            return blockNumber
          })
          .catch(() => 0)
      do {
        indexArray.push(await getCurrentIndex())
        if (indexArray.length > 10) indexArray.shift()
        await new Promise((resolve) => setTimeout(resolve, 100))
      } while (
        !indexArray.every((i) => i === indexArray[0]) ||
        indexArray.length < 2 ||
        indexArray[0] === 0
      )
    }
    /**
     * @type {import('concurrently').ConcurrentlyResult['result']}
     **/
    let result
    ;({ commands, result } = concurrently(cmdsToRun, {
      prefix: 'name',
    }))

    commands.forEach((cmd) => {
      if (inxsToFinishOnExit.includes(cmd.index)) {
        cmd.close.subscribe(({ exitCode }) => cleanup(undefined, exitCode))
      } else {
        cmd.close.subscribe(
          ({ exitCode }) => exitCode === 0 || cleanup(undefined, exitCode),
        )
      }
    })

    result.catch(cleanup.bind(null, { exit: true }))
  }
}

//do something when app is closing
process.on('exit', cleanup.bind(null, { cleanup: true }))

//catches ctrl+c event
process.on('SIGINT', cleanup.bind(null, { exit: true }))
