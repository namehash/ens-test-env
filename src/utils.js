import { spawn } from 'node:child_process'
import { Transform } from 'node:stream'
import compose from 'docker-compose'
import waitOn from 'wait-on'

/**
 * @param {{ method: string; params: unknown[]}[]} items
 * @template T
 * @returns {Promise<T>}
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
 * @param {string} method
 * @param {unknown[]} params
 * @template T
 * @returns {Promise<T>}
 */
export const rpcFetch = (method, params) =>
  batchRpcFetch([{ method, params }]).then((res) => res[0])

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
 * @param {string} command
 * @param {number} verbosity
 * @returns
 */
export const awaitCommand = async (name, command, verbosity) => {
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
 * @param {(exitCode: number | string) => void} cleanup
 * @param {import('docker-compose').IDockerComposeOptions} opts
 * @param {Buffer[]} exitedBuffers
 * @param {Buffer[]} outputsToIgnore
 * @param {number} verbosity
 */
export const logContainers = async (
  names,
  cleanup,
  opts,
  exitedBuffers,
  outputsToIgnore,
  verbosity,
) => {
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
 * @param {number} verbosity
 */
export const waitForENSNode = async (blockheight, verbosity) => {
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
