# ens-test-env

The test environment provides a way to run a full ENSv1 and ENSv2 deployment, as well as the ENSNode subgraph and metadata service via a single docker-compose file.

## How it works

Devnet from namechain deploys ENSv1 on L1 and ENSv1 on L1 and L2. Once devnet is fully deployed, the subgraph is started.

## Installation

POSIX shell, docker 20.10+ and docker-compose 2.0+ are required.

```sh
bun i -g @ensdomains/ens-test-env
```

## Usage

```sh
ens-test-env
```
To stop, simply press `ctrl+C`. Sometimes devnet might get stuck, in such case do `docker rm -f <name of the devnet container>`.
