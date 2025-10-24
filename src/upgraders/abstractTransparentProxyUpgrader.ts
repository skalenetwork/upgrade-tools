import {AddressLike, Contract} from "ethers";
import {ethers, upgrades} from "hardhat";
import {NonceProvider} from "../nonceProvider";
import {ProxyUpgrader} from "../proxyUpgrader";
import {TransparentProxyUpgrader} from "./transparentProxyUpgrader";
import chalk from "chalk";


export abstract class AbstractTransparentProxyUpgrader extends ProxyUpgrader {
    protected proxyAdmin: Contract | null = null;

    public static async create(
        contractName: string,
        proxyAddress: AddressLike,
        nonceProvider?: NonceProvider
    ) {
        const proxyAdmin = await this.getProxyAdmin(proxyAddress);
        let upgrader: AbstractTransparentProxyUpgrader | null = null;
        if (await this.isNewProxyAdmin(proxyAdmin)) {
            upgrader = new TransparentProxyUpgrader(
                contractName,
                proxyAddress,
                nonceProvider
            );
        } else {
            upgrader = new TransparentProxyUpgrader(
                contractName,
                proxyAddress,
                nonceProvider
            );
        }
        upgrader.proxyAdmin = proxyAdmin;
        return upgrader;
    }

    public async getOwner(): Promise<string> {
        return await this.proxyAdmin!.owner();
    }

    // Private

    private static async getProxyAdmin(proxy: AddressLike) {
        const proxyAdminAddress = await upgrades.erc1967.getAdminAddress(
            await ethers.resolveAddress(proxy)
        );
        const generalProxyAdminAbi = [
            "function UPGRADE_INTERFACE_VERSION() view returns (string)",
            "function upgrade(address,address)",
            "function upgradeAndCall(address,address,bytes) payable",
            "function owner() view returns (address)"
        ];
        return new ethers.Contract(
            proxyAdminAddress,
            generalProxyAdminAbi,
            await ethers.provider.getSigner()
        );
    }

    private static async isNewProxyAdmin(proxyAdmin: Contract) {
        try {
            console.log(chalk.gray(`ProxyAdmin version ${
                // This function name is set in external library
                // eslint-disable-next-line new-cap
                await proxyAdmin.UPGRADE_INTERFACE_VERSION()
            }`));
            return true;
        } catch (error) {
            console.log(chalk.gray("Use old ProxyAdmin"));
            return false;
        }
    }
}
