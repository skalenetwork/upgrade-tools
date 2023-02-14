# upgrade-tools

Scripts to support upgrades of smart contracts. The package contains common used functions for writing hardhat scripts for smart contracts deployment and upgrade.

## Upgrade scripts

To write an upgrade script extend `Upgrader` class.

```typescript
import { Upgrader } from "@skalenetwork/upgrade-tools";

class ExampleContractUpgrader extends Upgrader {

    getDeployedVersion = async () => {
        return await (await this.getExampleContract()).version();
    };

    setVersion = async (newVersion: string) => {
        const exampleContract = await this.getExampleContract();
        const setVersionTransaction = {
            to: exampleContract.address,
            data: exampleContract.interface.encodeFunctionData("setVersion", [newVersion])
        };
        this.transactions.push(setVersionTransaction);
    }

    async getExampleContract() {
        return await ethers.getContractAt("ExampleContract", this.abi["example_contract_address"] as string);
    }
}

async function main() {
    const abi = JSON.parse(await fs.readFile(process.env.ABI, "utf-8")) as SkaleABIFile;

    const upgrader = new ExampleContractUpgrader(
        "ExampleContract",
        "1.0.0",
        abi,
        ["ExampleContract"]
    );

    await upgrader.upgrade();
}

if (require.main === module) {
    main()
        .then(() => process.exit(0))
        .catch(error => {
            console.error(error);
            process.exit(1);
        });
}
```

### Abstract functions

The `Upgrader` has 2 abstract functions. It's mandatory to override them:

```typescript
abstract getDeployedVersion: () => Promise<string | undefined>
abstract setVersion: (newVersion: string) => Promise<void>
```

- `getDeployedVersion` returns string representing a deployed version of the contract
- `setVersion` creates a transaction to set a new version of the contract

### Protected functions

There are functions that may be overridden to customize an upgrade process

```typescript
deployNewContracts = () => { return Promise.resolve() };
initialize = () => { return Promise.resolve() };
```

- `deployNewContracts` is called before proxies upgrade and is used to deploy new instances
- `initialize` is called after proxies upgrade and is used to send initializing transactions
