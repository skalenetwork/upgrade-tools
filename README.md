# upgrade-tools

Scripts to support upgrades of smart contracts. The package contains common used functions for writing hardhat scripts for smart contracts deployment and upgrade.

## Upgrade scripts

To write upgrade script import `upgrade` function.

```typescript
import { upgrade } from "@skalenetwork/upgrade-tools"
```

Then call it with parameters below:

- `projectName` - project name
- `targetVersion` - version of smart contracts that can be upgraded by the script
- `getDeployedVersion` - a function to request current version from smart contracts
- `setVersion` - function that sets version to smart contracts
- `safeMockAccessRequirements` - list of smart contracts that requires ownership changing for successful upgrade (when EOA + SafeMock are used during upgrade)
- `contractNamesToUpgrade` - list of smart contracts to upgrade
- `deployNewContracts` - optional - a function that deploys new smart contracts
- `initialize` - optional - a function that setup smart contracts after upgrade
