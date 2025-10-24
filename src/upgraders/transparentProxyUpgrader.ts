import {AbstractTransparentProxyUpgrader} from "./abstractTransparentProxyUpgrader";
import {Transaction} from "ethers";
import {ethers} from "hardhat";

export class TransparentProxyUpgrader extends AbstractTransparentProxyUpgrader {
    protected async makeUpgradeTransaction(): Promise<Transaction> {
        return Transaction.from({
            "data": this.proxyAdmin!.interface.encodeFunctionData(
                "upgradeAndCall",
                [
                    await ethers.resolveAddress(this.proxyAddress),
                    await ethers.resolveAddress(this.newImplementationAddress!),
                    "0x"
                ]
            ),
            "to": await ethers.resolveAddress(this.proxyAdmin!)
        });
    }
}
