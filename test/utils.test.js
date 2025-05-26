import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import { rpcFetch } from '../src/utils.js'

describe('utils', () => {
  describe('rpcFetch', () => {
    /**
     * @type {import('node:test').Mock<typeof globalThis.fetch>}
     */
    let fetchMock

    beforeEach(() => {
      // Mock the global fetch function
      fetchMock = mock.method(globalThis, 'fetch', () =>
        Promise.resolve({
          json: () => Promise.resolve([]),
        }),
      )
    })

    afterEach(() => {
      fetchMock.mock.restore()
    })
    it('should call fetch with correct URL and method', async () => {
      const mockResponse = [{ jsonrpc: '2.0', id: 1, result: '0x1234' }]
      fetchMock.mock.mockImplementation(() =>
        Promise.resolve({
          json: () => Promise.resolve(mockResponse),
        }),
      )

      await rpcFetch('eth_getBalance', ['0x123', 'latest'])

      assert.strictEqual(fetchMock.mock.calls.length, 1)

      const [url, options] = fetchMock.mock.calls[0].arguments
      assert.strictEqual(url, 'http://localhost:8545')
      assert.strictEqual(options.method, 'POST')
      assert.strictEqual(options.headers['Content-Type'], 'application/json')
    })
    it('should handle RPC error responses', async () => {
      const mockResponse = [
        {
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32601, message: 'Method not found' },
        },
      ]
      fetchMock.mock.mockImplementation(() =>
        Promise.resolve({
          json: () => Promise.resolve(mockResponse),
        }),
      )

      const result = await rpcFetch('invalid_method', [])

      assert.deepStrictEqual(result, {
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32601, message: 'Method not found' },
      })
    })
  })
})
