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
