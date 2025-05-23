# Contributing

If you'd like to set up `ens-test-env` for development or contributitions, we recommend the following:

```bash

# clone ens-test-env & install deps
cd your-project-folder
git clone https://github.com/ensdomains/ens-test-env.git
cd ens-test-env
pnpm install

# clone ensjs & install deps
cd your-project-folder
git clone https://github.com/ensdomains/ensjs.git
cd ensjs
pnpm install

# IMPORTANT: point ensjs to the local version of ens-test-env
cd packages/ensjs
pnpm link ../../../ens-test-env

# NOTE: still in ensjs/packages/ensjs
pnpm run denv
```
