import {Manifest, hashBytecode} from "@openzeppelin/upgrades-core";
import {artifacts, ethers} from "hardhat";
import {promises as fs} from "fs";
import {SkaleManifestData} from "./types/SkaleManifestData";
import {Artifact} from "hardhat/types";

const _deployLibrary = async (libraryName: string) => {
    const
        Library = await ethers.getContractFactory(libraryName);
    const library = await Library.deploy();
    await library.deployed();
    return library.address;
};

export const deployLibraries = async (libraryNames: string[]) => {
    const libraries = new Map<string, string>();
    for (const libraryName of libraryNames) {
        libraries.set(
            libraryName,
            await _deployLibrary(libraryName)
        );
    }
    return libraries;
};

const _linkBytecode = (artifact: Artifact, libraries: Map<string, string>) => {
    let {bytecode} = artifact;
    for (const [, fileReferences] of Object.entries(artifact.linkReferences)) {
        for (const [
            libName,
            fixups
        ] of Object.entries(fileReferences)) {
            const addr = libraries.get(libName);
            if (addr === undefined) {
                continue;
            }
            for (const fixup of fixups) {
                bytecode =
                bytecode.substr(
                    0,
                    2 + fixup.start * 2
                ) +
                addr.substr(2) +
                bytecode.substr(2 + (fixup.start + fixup.length) * 2);
            }
        }
    }
    return bytecode;
};

export const getLinkedContractFactory = async (contractName: string, libraries: Map<string, string>) => {
    const
        cArtifact = await artifacts.readArtifact(contractName);
    const linkedBytecode = _linkBytecode(
        cArtifact,
        libraries
    );
    const ContractFactory = await ethers.getContractFactory(
        cArtifact.abi,
        linkedBytecode
    );
    return ContractFactory;
};

export const getManifestFile = async (): Promise<string> => (await Manifest.forNetwork(ethers.provider)).file;

export const getContractFactory = async (contract: string) => {
    const {linkReferences} = await artifacts.readArtifact(contract);
    if (!Object.keys(linkReferences).length) {
        return await ethers.getContractFactory(contract);
    }

    const libraryNames = [];
    for (const key of Object.keys(linkReferences)) {
        const libraryName = Object.keys(linkReferences[key])[0];
        libraryNames.push(libraryName);
    }

    const
        libraries = await deployLibraries(libraryNames);
    const libraryArtifacts: { [key: string]: unknown } = {};
    for (const [
        libraryName,
        libraryAddress
    ] of libraries.entries()) {
        const {bytecode} = await artifacts.readArtifact(libraryName);
        libraryArtifacts[libraryName] = {
            "address": libraryAddress,
            "bytecodeHash": hashBytecode(bytecode)
        };
    }
    let manifest;
    try {
        manifest = JSON.parse(await fs.readFile(
            await getManifestFile(),
            "utf-8"
        )) as SkaleManifestData;
        Object.assign(
            libraryArtifacts,
            manifest.libraries
        );
    } finally {
        if (manifest !== undefined) {
            Object.assign(
                manifest,
                {"libraries": libraryArtifacts}
            );
        }
        await fs.writeFile(
            await getManifestFile(),
            JSON.stringify(
                manifest,
                null,
                4
            )
        );
    }
    return await getLinkedContractFactory(
        contract,
        libraries
    );
};
