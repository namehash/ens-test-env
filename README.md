# ens-test-env

`ens-test-env` runs Anvil and ENSNode for the purposes of testing ENS.

## Configuration

To run your scripts in the context of the `ens-test-env`, you must provide a config file to `ens-test-env`.

```js
/**
 * @type {import('@ensdomains/ens-test-env').ENSTestEnvConfig}
 **/
module.exports = {
  deployCommand: 'pnpm hardhat deploy',
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

For most testing situations you can use the default settings, which will create a fresh mainnet fork from a specified block as well as deploying a fresh subgraph with the same specified block as it's start block.

Tests should ideally be designed to be stateless where possible, which entails not using hardcoded addresses and not relying on any specific blockchain/graph state. This allows for a much higher test reliability and low maintenance.

### Stateful

Some tests may require a specific existing state, for example if a test relies on an old deployment of a contract which can no longer be accurately replicated from a fresh mainnet fork. The stateful environment uses pre-existing subgraph data at a specified block to allow full state access prior to the mainnet fork.

The stateful environment can also be used to more closely replicate a production environment for true full end-to-end tests. You may also want to use this environment for testing with your own personal wallet without using mainnet.

The downside of using the stateful environment is that a test can potentially become unreliable if one of it's dependencies changes. Alongside reliability, running a stateful test most of the time will require access to a specific private key. Given this, you should try to avoid writing stateful tests wherever possible.

## Contract deployments

Contract deployments are a small but necessary part of testing, you can deploy contracts to
both stateless and stateful environments. After the locally tested contract is deployed, the
deployment script should be left in the repo to serve as an archive.

## Updating the graph-node dataset

Generally, you will want to set a graft variable in the `subgraph.yaml` file for the subgraph. You can find more about the ENS subgraph [here](https://github.com/ensdomains/ens-subgraph). You'll also documentation for grafting available [here](https://thegraph.com/docs/en/developer/create-subgraph-hosted/#grafting-onto-existing-subgraphs).

To update the graph-node dataset, the BLOCK_HEIGHT variable must be changed within the `.env` file. It should be set to the same value as the graft block.

If the dataset is a dependency for a local test, you will need to first let your local graph-node
dataset update so that your test can pass.

Once your data is up to date, you can run

```bash
pnpm ens-test-env data --compress
```

in this directory, which will give you a archive file for your dataset.

### Dataset naming scheme

```js
const file = `data_${BLOCK_HEIGHT}_${SUBGRAPH_ID}_${EPOCH_TIME}_${NETWORK}.archive`
// e.g. data_14119046_QmTmU4syjQb8gfNq8TCQGv441qp2zQMNKnQ4smjKhpLQ6F_1643850493_ropsten.archive.tar.gz
```

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

## Contributing

If you'd like to set up `ens-test-env` for development or contributitions, we recommend the following:

```bash

# clone ens-test-env & install deps
cd your-project-folder
git clone https://github.com/ensdomains/ens-test-env.git
cd ens-test-env
pnpm install

# clone ensjs & install deps
cd your-project-folder
git clone https://github.com/namehash/ensjs.git
cd ensjs
pnpm install

# IMPORTANT: point ensjs to the local version of ens-test-env
cd packages/ensjs
pnpm link ../../../ens-test-env

# NOTE: still in ensjs/packages/ensjs
pnpm run denv
```
