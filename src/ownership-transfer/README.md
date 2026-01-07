# Ownership transfers

SKALE smart contract projects are generally organized with project name, and contract names related to this project.

Example.: `skale-manager` includes `SkaleToken`, `SkaleManager`, `ContractManager`, etc...

The classes and set of helper functions in this directory aim to assist in the swift and supervised transfer of ownership of these projects.

## How it works

### 1. Fill Metadata

First of, the tool ensures it has all required information to proceed (Contract Names and addresses).
Then it passes on to the more complex gathering of information. For each contract, the tool must classify it given two different areas: **Upgradeability Pattern** and **Permission Model**.

Each contract can only have **one** of the following upgradeability patterns (for skale projects, as of the last update of this document): **Transparent Upgradeability Pattern (TUP)**, **Beacon Upgradeability Pattern (BEACON)** or **REGULAR** (meaning no upgradeability).
To do so, the tool resorts to using (EIP-1967)[https://eips.ethereum.org/EIPS/eip-1967] and ABIs of Openzeppelin implementations to query if or not a contract is a **TUP** or **BEACON** proxy, and defaults to **REGULAR** if it does not find reasons to believe otherwise.

Each contract can have multiple classifications regarding the **Permission Model** they use, as most do not necessarily exclude one another (except for rare occasions): **AccessManaged**, **RoleBased**, **AccessManager**, **Ownable**.

By the current standards, it's verified that:
* If a contract is **TUP**, it has a `ProxyAdmin`, and this proxyAdmin is **Ownable**.
* If a contract is **BEACON**, it is **Ownable**.

Other details:
* If a contract is **AccessManaged**, it is not **AccessManager** (and vice-versa). This is a design choice
* If a contract is `Ownable2Step`, this tool does NOT confirm the change of ownership, and correctly classifies the contract as **Ownable**.

### 2. Check current ownership status

In this step, the script will scan each contract, and it's `ProxyAdmin` contracts if any, and decide whether or not there are any permissions given to **oldOwner** that the **newOwner** does not yet have.

If there is, you will see an output with lines like the following (where you should confirm your findings):
<img width="940" height="607" alt="image" src="https://github.com/user-attachments/assets/00cc01e2-ffbe-44bf-872e-edc19f446282" />

Note that if there is at least 1 transaction in this step, even thought the script might detect transactions for the next step, it will only execute the transactions from this step first and then re-scan the contracts for the next phase.

If no contracts have transactions for this step, the script skips to the next immediately (no need to re-scan).

At the end of this step, the script will collect all transactions for this step and confirm with the user to send them to the blockchain:
<img width="1313" height="367" alt="image" src="https://github.com/user-attachments/assets/f08566ab-48af-4717-913f-621cac7af6a8" />

### 3. Check if there are roles to revoke

The script re-scans the contracts IF **revokeRoles** option is enabled.
This step looks for any access that the **oldOwner** still has. It marks all roles passed as input to revoke from the **oldOwner**.

The only exceptions are `DEFAULT_ADMIN_ROLE` and `ADMIN_ROLE` for **RoleBased** and **AccessManager** respectively. For these two roles, it only revokes the role from the **oldOwner** IF both have the role - this is an extra layer of protection to avoid cases in which no root role is lost completely which can be fatal in non-upgradeable contracts.

IF there are roles to revoke, you expect an output like the following, which you should confirm or not:
<img width="887" height="599" alt="image" src="https://github.com/user-attachments/assets/15a6dc0e-17fb-4c22-85ac-5231bfbe37e7" />

If there are no roles to revoke, you expect an output as in Step4 "ALL DONE".
At the end of this step, the script will collect all transactions for this step and confirm with the user to send them to the blockchain (Simmilar to step 2).

### 4. End

If all steps are completed, the following output is expected:
<img width="895" height="567" alt="image" src="https://github.com/user-attachments/assets/4915b528-266b-4d98-8c12-de0cbbd25f4a" />


If **revokeRoles** step is disabled, the final output will be the one at the end of Step 3 - You may see lines with "REVOKE ROLES REQUIRED".

## How to write a transfer ownership script

### Main setup

```typescript
// ===> Start of logic to read env variables

/*
Here goes logic to read environment variables that are required to fill the Options for InstanceAdmin
Recommended to use the following standards on SKALE repos:

NEW_OWNER: Address of the new owner
TARGET: Address of the main contract of the skale project
REVOKE_ROLES: Wether or not to revoke roles from the oldOwner (relevant whenever renouncing is possible/necessary)
MULTISIG_OWNER: If the owner of the project is a Multisig, provide the address of the Multisig contract on the network.

READONLY: read-only mode enabled or not.
TEST_MODE: test-mode enabled or not.

*/

const contractsWithOwnershipToChange = contracts;
let readonly = false;
let renounceRoles = true;
let testMode = false;
let oldOwner: string;
let submitter: EoaSubmitter | SafeSubmitter;

if (!process.env.NEW_OWNER) {
    throw new Error("Please set NEW_OWNER env variable");
}

if (!process.env.TARGET) {
    throw new Error("Please set TARGET env variable");
}

if (process.env.READONLY) {
    readonly = process.env.READONLY === "true";
}

if (process.env.TEST_MODE === "true") {
    readonly = false;
    renounceRoles = true;
    testMode = true;
}

if (process.env.REVOKE_ROLES) {
    renounceRoles = process.env.REVOKE_ROLES === "true";
}

if (process.env.MULTISIG_OWNER) {
    oldOwner = process.env.MULTISIG_OWNER;
    submitter = new SafeSubmitter(oldOwner);
} else {
    oldOwner = (await ethers.getSigners())[0].address;
    submitter = new EoaSubmitter();
}

// ===> End of logic to read env variables

// Create Options
const options: InstanceAdminOptions = {
    // ...
    // ...
}

// add Instance or contract Names & addresses.
const contractsWithOwnershipToChange = ["SkaleManager", "SkaleToken"]; // Example

// Choose option 1, 2 or mix
// 1 -> fill contractMap manually:
const contractMap = contractsWithOwnershipToChange.map(contract => ({name: contract, address: getAddress(contract)}));
// getAddress function is a mock. the consumer should provide the address somehow or find a way to get it
const admin = new InstanceAdmin(contractMap, options);

// 2 -> Use power of skaleContracts
const contractMap = contractsWithOwnershipToChange.map(contract => ({name: contract}));
const network = await skaleContracts.getNetworkByProvider(ethers.provider);
const project = network.getProject("skale-manager");
const instance = await project.getInstance(process.env.TARGET);
const admin = new InstanceAdmin(contractMap, options, instance);
// InstanceAdmin will query contract addresses from `instance` under the hood

// 3 -> mix
const contractMap = [
    {name: "SkaleToken", address: "0xCustomAddress"},
    {name: "SkaleManager"}
];
const project = network.getProject("skale-manager");
const instance = await project.getInstance(process.env.TARGET);
const admin = new InstanceAdmin(contractMap, options, instance);
// InstanceAdmin will query only missing contract addresses from `instance`, it trusts the provided addresses

// Finally execute

await admin.executeOwnershipTransfer();
```

### Configs

Everything is performed by the class [InstanceAdmin](./instanceAdmin.ts). It's important to understand it's configuration.

```typescript
interface InstanceAdminOptions {
    oldOwner: string;
    submitter: SafeSubmitter | EoaSubmitter;
    renounceRoles: boolean;
    newOwner: string;
    readonly: boolean;
    testMode: boolean;
    rolesToCheck?: string[];
    managerRolesToCheck?: bigint[];
}
```

* **oldOwner:** Address of the current owner of the project. This should be an account that is both `owner` of ProxyAdmin contracts (if any are upgradeable), and ownership of the contracts themselves (usually through `Ownable`, `AccessManager` or `AccessControl` patterns from Openzeppelin).

* **submitter:** It should be coherent with the `oldOwner` parameter. If the oldOwner is a contract the submitter should be a `SafeSubmitter`, or `EoaSubmitter` otherwise.

* **renounceRoles:** Wether or not to renounce the roles that do not have to be **transferred**, just **granted**, from the oldOwner. If set to **false**, it will skip the step of renouncing roles (if any to renounce). `Ownable` contracts cannot have two owners, therefore this variable has no effect on those (ownership is **transferred**).

* **newOwner:** The address of the new Owner.

* **readonly:** If set to **true**, the class will only scan the current state of the contracts and print the next actions it would perform (it will NOT submit transactions to the chain).

* **testMode:** By default, the script will interact with the user to confirm each step, as this is a sensitive operation. If `testMode` is set to **true**, this interaction with the user is skipped and everything is executed without manual confirmation of findings. It is recommended to ALWAYS set to **false**, except on local testing environments.

* **rolesToCheck:** It is of the responsibility of the programmer or developer of the script to include in this array all the names of the roles that the script is supposed to check for, besides `DEFAULT_ADMIN_ROLE` which the script checks always. This is only relevant for projects/contracts that use `AccessControl` access pattern from Openzeppelin. The array should contain a set of role names, which the script translates into bytes32 using `keccak256` hash function. An example can be found [here](https://github.com/skalenetwork/skale-manager/blob/cb48a81ef0c2145384d3ed92d3885a82dba5c333/migrations/changeOwnership.ts#L59) for skale-manager project.

* **managerRolesToCheck:** Some SKALE recent projects use an `AccessManager` Openzeppelin contract to manage permissions. In this patter, roles are identified as `uint64` values. Again is of the responsibility of the script developer to include in this array all the identifiers or the roles used in the project for the script to be able to check each one. This excludes role ID `0`, which is the `DEFAULT_ADMIN`, and is always checked by the script.

