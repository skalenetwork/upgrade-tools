import {ethers, network, run} from "hardhat";
import {builtinChains} from "@nomicfoundation/hardhat-verify/internal/chain-config";
import chalk from "chalk";
import {getImplementationAddress} from "@openzeppelin/upgrades-core";

export async function verify (contractName: string, contractAddress: string, constructorArguments: object) {
    const {chainId} = await ethers.provider.getNetwork();
    if (builtinChains.find((chain) => chain.chainId === chainId) !== undefined) {
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
            } catch (e) {
                if (e instanceof Error) {
                    if (e.toString().includes("Contract source code already verified")) {
                        console.log(chalk.grey(`${contractName} is already verified`));
                        return;
                    }
                    console.log(chalk.red(`Contract ${contractName} was not verified on etherscan`));
                    console.log(e.toString());
                } else {
                    console.log(
                        "Unknown exception type:",
                        e
                    );
                }
            }
        }
    }
}

export async function verifyProxy (contractName: string, proxyAddress: string, constructorArguments: object) {
    await verify(
        contractName,
        await getImplementationAddress(
            network.provider,
            proxyAddress
        ),
        constructorArguments
    );
}
