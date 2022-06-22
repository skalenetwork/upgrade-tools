import { Manifest, hashBytecode } from "@openzeppelin/upgrades-core";
import { ethers, artifacts } from "hardhat";
import { promises as fs } from 'fs';
import { SkaleManifestData } from "./types";
import { Artifact } from "hardhat/types";

async function _deployLibrary(libraryName: string) {
    const Library = await ethers.getContractFactory(libraryName);
    const library = await Library.deploy();
    await library.deployed();
    return library.address;
}

export async function deployLibraries(libraryNames: string[]) {
    const libraries = new Map<string, string>();
    for (const libraryName of libraryNames) {
        libraries.set(libraryName, await _deployLibrary(libraryName));
    }
    return libraries;
}

function _linkBytecode(artifact: Artifact, libraries: Map<string, string>) {
    let bytecode = artifact.bytecode;
    for (const [, fileReferences] of Object.entries(artifact.linkReferences)) {
        for (const [libName, fixups] of Object.entries(fileReferences)) {
            const addr = libraries.get(libName);
            if (addr === undefined) {
                continue;
            }
            for (const fixup of fixups) {
                bytecode =
                bytecode.substr(0, 2 + fixup.start * 2) +
                addr.substr(2) +
                bytecode.substr(2 + (fixup.start + fixup.length) * 2);
            }
        }
    }
    return bytecode;
}

export async function getLinkedContractFactory(contractName: string, libraries: Map<string, string>) {
    const cArtifact = await artifacts.readArtifact(contractName);
    const linkedBytecode = _linkBytecode(cArtifact, libraries);
    const ContractFactory = await ethers.getContractFactory(cArtifact.abi, linkedBytecode);
    return ContractFactory;
}

export function getContractKeyInAbiFile(contract: string) {
    return contract.replace(/([a-zA-Z])(?=[A-Z])/g, '$1_').toLowerCase();
}

export async function getManifestFile(): Promise<string> {
    return (await Manifest.forNetwork(ethers.provider)).file;
}

export async function getContractFactory(contract: string) {
    const { linkReferences } = await artifacts.readArtifact(contract);
    if (!Object.keys(linkReferences).length)
        return await ethers.getContractFactory(contract);

    const libraryNames = [];
    for (const key of Object.keys(linkReferences)) {
        const libraryName = Object.keys(linkReferences[key])[0];
        libraryNames.push(libraryName);
    }

    const libraries = await deployLibraries(libraryNames);
    const libraryArtifacts: {[key: string]: unknown} = {};
    for (const [libraryName, libraryAddress] of libraries.entries()) {
        const { bytecode } = await artifacts.readArtifact(libraryName);
        libraryArtifacts[libraryName] = {"address": libraryAddress, "bytecodeHash": hashBytecode(bytecode)};
    }
    let manifest;
    try {
        manifest = JSON.parse(await fs.readFile(await getManifestFile(), "utf-8")) as SkaleManifestData;
        Object.assign(libraryArtifacts, manifest.libraries);
    } finally {
        if (manifest !== undefined) {
            Object.assign(manifest, {libraries: libraryArtifacts});
        }
        await fs.writeFile(await getManifestFile(), JSON.stringify(manifest, null, 4));
    }
    return await getLinkedContractFactory(contract, libraries);
}