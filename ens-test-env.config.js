import path from 'node:path'

/**
 * @type {import('./src/config').ENSTestEnvConfig}
 * */
export default {
  deployCommand: 'pnpm hardhat deploy',
  buildCommand: 'pnpm build',
  labelHashes: [
    {
      hash: '0x4f5b812789fc606be1b3b16908db13fc7a9adf7ca72641f84d75b47069d3d7f0',
      label: 'eth',
    },
  ],
  scripts: [
    {
      command: 'example',
      name: 'example',
      prefixColor: 'blue.bold',
      cwd: path.resolve('./'),
      finishOnExit: true,
    },
  ],
  paths: {
    data: './data',
    composeFile: './src/docker-compose.yml',
  },
}
