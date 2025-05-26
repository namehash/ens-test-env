import { spawn } from 'node:child_process'
import { Transform } from 'node:stream'

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
