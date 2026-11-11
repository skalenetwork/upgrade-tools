import * as typechain from "../typechain-types";
import {EoaSubmitter, InstanceAdmin} from "../src";
import {Transaction} from "ethers";
import assert from "assert/strict";
import {ethers} from "hardhat";

const PROXY_NAMES = ["ProxyA", "ProxyB", "ProxyC"];

class RecordingEoaSubmitter extends EoaSubmitter {
    submitted: Transaction[] = [];

    async submit (transactions: Transaction[]) {
        this.submitted.push(...transactions);
        await super.submit(transactions);
    }
}

const deployProxiesWithSharedProxyAdmin = async () => {
    const [deployer] = await ethers.getSigners();
    const proxyAdmin = await new typechain.ProxyAdmin__factory(deployer).deploy();
    // Any contract works as the implementation, the test only checks ownership of the ProxyAdmin
    const implementation = await new typechain.ProxyAdmin__factory(deployer).deploy();
    const proxyFactory = new typechain.AdminUpgradeabilityProxy__factory(deployer);
    const proxies: {name: string, address: string}[] = [];
    for (const name of PROXY_NAMES) {
        // eslint-disable-next-line no-await-in-loop
        const proxy = await proxyFactory.deploy(implementation, proxyAdmin, "0x");
        // eslint-disable-next-line no-await-in-loop
        proxies.push({address: await proxy.getAddress(), name});
    }
    return {proxies, proxyAdmin};
};

describe("InstanceAdmin", () => {
    it("transfers ownership of a ProxyAdmin shared among several proxies", async () => {
        const [oldOwner, newOwner] = await ethers.getSigners();
        const {proxies, proxyAdmin} = await deployProxiesWithSharedProxyAdmin();
        const submitter = new RecordingEoaSubmitter();
        const instanceAdmin = new InstanceAdmin(
            proxies,
            {
                newOwner: newOwner.address,
                oldOwner: oldOwner.address,
                readonly: false,
                renounceRoles: false,
                submitter,
                testMode: true
            }
        );

        await instanceAdmin.executeOwnershipTransfer();

        assert.equal(await proxyAdmin.owner(), newOwner.address);
        assert.deepEqual(
            submitter.submitted.map(tx => [tx.to, tx.data]),
            [
                [
                    await proxyAdmin.getAddress(),
                    proxyAdmin.interface.encodeFunctionData("transferOwnership", [newOwner.address])
                ]
            ]
        );
    });
});
