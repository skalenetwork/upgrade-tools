import {ethers, network, run} from "hardhat";
import {builtinChains} from "@nomicfoundation/hardhat-verify/internal/chain-config";
import chalk from "chalk";
import {getImplementationAddress} from "@openzeppelin/upgrades-core";

export const verify = async (contractName: string, contractAddress: string, constructorArguments: object) => {
    const {chainId} = await ethers.provider.getNetwork();
    if (builtinChains.find((chain) => chain.chainId === chainId) === undefined) {
        console.log(chalk.grey("Verification on this network is not supported"));
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
                if (error.toString().includes("Contract source code already verified")) {
                    console.log(chalk.grey(`${contractName} is already verified`));
                    return;
                }
                console.log(chalk.red(`Contract ${contractName} was not verified on etherscan`));
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

export const verifyProxy = async (contractName: string, proxyAddress: string, constructorArguments: object) => {
    await verify(
        contractName,
        await getImplementationAddress(
            network.provider,
            proxyAddress
        ),
        constructorArguments
    );
};
