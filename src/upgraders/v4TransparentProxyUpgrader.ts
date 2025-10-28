import {AbstractTransparentProxyUpgrader} from "./abstractTransparentProxyUpgrader";
import {Transaction} from "ethers";
import {ethers} from "hardhat";

export class V4TransparentProxyUpgrader extends AbstractTransparentProxyUpgrader {
    protected async makeUpgradeTransaction(): Promise<Transaction> {
        return Transaction.from({
            "data": this.proxyAdmin!.interface.encodeFunctionData(
                "upgrade",
                [
                    await ethers.resolveAddress(this.proxyAddress),
                    await ethers.resolveAddress(this.newImplementationAddress!),
                ]
            ),
            "to": await ethers.resolveAddress(this.proxyAdmin!)
        });
    }
}
