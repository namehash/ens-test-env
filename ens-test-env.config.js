import path from 'node:path'

/**
 * @type {import('./src/config').ENSTestEnvConfig}
 * */
export default {
  deployCommand: 'pnpm hardhat deploy',
  buildCommand: 'pnpm build',
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
    composeFile: './src/docker-compose.yml',
  },
}
