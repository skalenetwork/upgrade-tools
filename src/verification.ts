import {ethers, network, run} from "hardhat";
import {
    builtinChains
} from "@nomicfoundation/hardhat-verify/internal/chain-config";
import chalk from "chalk";
import {getImplementationAddress} from "@openzeppelin/upgrades-core";

const processError = (error: unknown, contractName: string) => {
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
};

const verificationAttempt = async (
    contractName: string,
    contractAddress: string,
    constructorArguments: object
) => {
    try {
        await run(
            "verify:verify",
            {
                "address": contractAddress,
                constructorArguments
            }
        );
        return true;
    } catch (error) {
        processError(
            error,
            contractName
        );
    }
    return false;
};

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
        if (await verificationAttempt(
            contractName,
            contractAddress,
            constructorArguments
        )) {
            break;
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
