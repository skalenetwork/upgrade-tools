import {AddressLike, Contract, Transaction} from "ethers";
import {ethers, upgrades} from "hardhat";
import chalk from "chalk";

export const getProxyAdmin = async (proxy: AddressLike) => {
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

export const isNewProxyAdmin = async (proxyAdmin: Contract) => {
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

export const getUpgradeTransaction = async (proxy: AddressLike, implementation: AddressLike) => {
    const proxyAdmin = await getProxyAdmin(proxy);
    if (await isNewProxyAdmin(proxyAdmin)) {
        return Transaction.from({
            "data": proxyAdmin.interface.encodeFunctionData(
                "upgradeAndCall",
                [
                    await ethers.resolveAddress(proxy),
                    await ethers.resolveAddress(implementation),
                    "0x"
                ]
            ),
            "to": await ethers.resolveAddress(proxyAdmin)
        });
    }
    return Transaction.from({
        "data": proxyAdmin.interface.encodeFunctionData(
            "upgrade",
            [
                await ethers.resolveAddress(proxy),
                await ethers.resolveAddress(implementation),
            ]
        ),
        "to": await ethers.resolveAddress(proxyAdmin)
    });
}
