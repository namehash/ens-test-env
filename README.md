# ens-test-env

## How it works

The testing environment used here is implemented in the stateless and stateful
tests for ENS app. The environment consists of two parts: the Anvil Ethereum
node, and the docker graph instance. Which environment type you use is dependent
on your testing circumstances.

## Configuration

There should be a file named `ens-test-env.config.js` in your project's root
directory. You can add a JSDoc type import to import the config type.

```js
/**
 * @type {import('@ensdomains/ens-test-env').ENSTestEnvConfig}
 **/
export {
  deployCommand: 'pnpm hardhat deploy',
  docker: {
    file: './docker-compose.yml',
    sudo: false,
  },
  graph: {
    bypassLocal: false,
  },
  scripts: [
    {
      command: 'example',
      name: 'example',
      prefixColor: 'blue.bold',
      cwd: path.resolve('./'),
      finishOnExit: true,
    },
  ],
}
```

## Pull Docker Images

To make the initial run faster, consider pulling the ENSNode Docker images separately:

```bash
docker pull docker.io/library/postgres:17
docker pull ghcr.io/foundry-rs/foundry:stable
docker pull ghcr.io/namehash/ensnode/ensindexer:stable
docker pull ghcr.io/namehash/ensnode/ensrainbow-test:latest
docker pull ghcr.io/ensdomains/ens-metadata-service:latest
```

## Environment Types

### Stateless

For most testing situations you can use the default settings, which will create
a fresh mainnet fork from a specified block as well as deploying a fresh
subgraph with the same specified block as it's start block.

Tests should ideally be designed to be stateless where possible, which entails
not using hardcoded addresses and not relying on any specific blockchain/graph
state. This allows for a much higher test reliability and low maintenance.

### Stateful

Some tests may require a specific existing state, for example if a test relies
on an old deployment of a contract which can no longer be accurately replicated
from a fresh mainnet fork. The stateful environment uses pre-existing subgraph
data at a specified block to allow full state access prior to the mainnet fork.

The stateful environment can also be used to more closely replicate a production
environment for true full end-to-end tests. You may also want to use this
environment for testing with your own personal wallet without using mainnet.

The downside of using the stateful environment is that a test can potentially
become unreliable if one of it's dependencies changes. Alongside reliability,
running a stateful test most of the time will require access to a specific
private key. Given this, you should try to avoid writing stateful tests wherever
possible.

## Contract deployments

Contract deployments are a small but necessary part of testing, you can deploy
contracts to both stateless and stateful environments. After the locally tested
contract is deployed, the deployment script should be left in the repo to serve
as an archive.

## Running the environment

After this you can run:

```bash
# Start
pnpm ens-test-env start
# Load data only
pnpm ens-test-env data --load
# Export generated data
pnpm ens-test-env data --compress
```
