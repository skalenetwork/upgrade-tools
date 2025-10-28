import {ProxyUpgrader} from "../proxyUpgrader";
import {Transaction} from "ethers";
import {ethers} from "hardhat";


export class BeaconUpgrader extends ProxyUpgrader {
    public async getOwner(): Promise<string> {
        const beacon = await this.getBeacon();
        return await beacon.owner();
    }

    protected async makeUpgradeTransaction(): Promise<Transaction> {
        const beacon = await this.getBeacon();
        return Transaction.from({
            "data": beacon.interface.encodeFunctionData(
                "upgradeTo",
                [
                    await ethers.resolveAddress(this.newImplementationAddress!),
                ]
            ),
            "to": await ethers.resolveAddress(beacon)
        });
    }

    // Private

    private async getBeacon() {
        const generalUpgradeableBeaconAbi = [
            "function upgradeTo(address newImplementation)",
            "function owner() returns (address)"
        ];
        return new ethers.Contract(
            await ethers.resolveAddress(this.proxyAddress),
            generalUpgradeableBeaconAbi,
            await ethers.provider.getSigner()
        );
    }
}
