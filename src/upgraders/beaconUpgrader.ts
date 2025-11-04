import {AddressLike, Transaction} from "ethers";
import {ProxyUpgrader} from "../proxyUpgrader";
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

    // Protected

    protected async getCurrentImplementationAddress(): Promise<AddressLike> {
        const beacon = await this.getBeacon();
        return await beacon.implementation();
    }

    // Private

    private async getBeacon() {
        const generalUpgradeableBeaconAbi = [
            "function implementation() view returns (address)",
            "function owner() view returns (address)",
            "function upgradeTo(address newImplementation)",
        ];
        return new ethers.Contract(
            await ethers.resolveAddress(this.proxyAddress),
            generalUpgradeableBeaconAbi,
            await ethers.provider.getSigner()
        );
    }
}
