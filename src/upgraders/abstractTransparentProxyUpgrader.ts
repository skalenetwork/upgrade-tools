import {AddressLike, Contract} from "ethers";
import {ethers, upgrades} from "hardhat";
import {NonceProvider} from "../nonceProvider";
import {ProxyUpgrader} from "../proxyUpgrader";
import chalk from "chalk";

interface TransparentProxyUpgraderConstructorArguments {
    contractName: string;
    proxyAddress: AddressLike;
    proxyAdmin: Contract;
    nonceProvider?: NonceProvider;
}

export abstract class AbstractTransparentProxyUpgrader extends ProxyUpgrader {
    protected proxyAdmin: Contract;

    constructor (
        options: TransparentProxyUpgraderConstructorArguments
    ) {
        super(options.contractName, options.proxyAddress, options.nonceProvider);
        this.proxyAdmin = options.proxyAdmin;
    }

    public async getOwner(): Promise<string> {
        return await this.proxyAdmin.owner();
    }

    public static async getProxyAdmin(proxy: AddressLike) {
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

    public static async getProxyAdminVersion(proxyAdmin: Contract) {
        try {
            // This function name is set in external library
            // eslint-disable-next-line new-cap
            return await proxyAdmin.UPGRADE_INTERFACE_VERSION() as string;
        } catch (error) {
            return null;
        }
    }

    public static async isNewProxyAdmin(proxyAdmin: Contract) {
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
