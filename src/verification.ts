import {ethers, network, run} from "hardhat";
import {
    builtinChains
} from "@nomicfoundation/hardhat-verify/internal/chain-config";
import chalk from "chalk";
import {getImplementationAddress} from "@openzeppelin/upgrades-core";

export const verify = async (
    contractName: string,
    contractAddress: string,
    constructorArguments: object
) => {
    const {chainId} = await ethers.provider.getNetwork();
    if (!builtinChains.map((chain) => chain.chainId).includes(chainId)) {
        const errorMessage = "Verification on this network is not supported";
        console.log(chalk.grey(errorMessage));
        return;
    }
    for (let retry = 0; retry <= 5; retry += 1) {
        try {
            await run(
                "verify:verify",
                {
                    "address": contractAddress,
                    constructorArguments
                }
            );
            break;
        } catch (error) {
            if (error instanceof Error) {
                const alreadyVerifiedErrorLine =
                    "Contract source code already verified";
                if (error.toString().includes(alreadyVerifiedErrorLine)) {
                    const infoMessage = `${contractName} is already verified`;
                    console.log(chalk.grey(infoMessage));
                    return;
                }
                const errorMessage =
                    `Contract ${contractName} was not verified on etherscan`;
                console.log(chalk.red(errorMessage));
                console.log(error.toString());
            } else {
                console.log(
                    "Unknown exception type:",
                    error
                );
            }
        }
    }
};

export const verifyProxy = async (
    contractName: string,
    proxyAddress: string,
    constructorArguments: object
) => {
    await verify(
        contractName,
        await getImplementationAddress(
            network.provider,
            proxyAddress
        ),
        constructorArguments
    );
};
