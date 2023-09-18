import {Manifest, hashBytecode} from "@openzeppelin/upgrades-core";
import {artifacts, ethers} from "hardhat";
import {promises as fs} from "fs";
import {SkaleManifestData} from "./types/SkaleManifestData";
import {Artifact, LinkReferences} from "hardhat/types";

interface LibraryArtifacts {
    [key: string]: unknown
}

const deployLibrary = async (libraryName: string, nonce: number) => {
    const Library = await ethers.getContractFactory(libraryName);
    const library = await Library.deploy({nonce});
    await library.deployed();
    return library.address;
};

export const deployLibraries = async (libraryNames: string[]) => {
    const [deployer] = await ethers.getSigners();
    const nonce = await deployer.getTransactionCount();
    const libraries = new Map<string, string>();

    (await Promise.all(libraryNames.map((libraryName, index) => (async () => [
        libraryName,
        await deployLibrary(
            libraryName,
            nonce + index
        )
    ])()))).forEach(([
        libraryName,
        libraryAddress
    ]) => {
        libraries.set(
            libraryName,
            libraryAddress
        );
    });

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
            if (addr !== undefined) {
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
    }
    return bytecode;
};

export const getLinkedContractFactory = async (
    contractName: string,
    libraries: Map<string, string>
) => {
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

export const getManifestFile = async function getManifestFile () {
    return (await Manifest.forNetwork(ethers.provider)).file;
};

const updateManifest = async (libraryArtifacts: LibraryArtifacts) => {
    const manifest = JSON.parse(await fs.readFile(
        await getManifestFile(),
        "utf-8"
    )) as SkaleManifestData;
    if (manifest.libraries === undefined) {
        Object.assign(
            manifest,
            {"libraries": libraryArtifacts}
        );
    } else {
        Object.assign(
            libraryArtifacts,
            manifest.libraries
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
};

const getLibraryArtifacts = async (libraries: Map<string, string>) => {
    const libraryArtifacts: LibraryArtifacts = {};

    const getLibraryArtifact = async (
        libraryName: string,
        libraryAddress: string
    ) => {
        const {bytecode} = await artifacts.readArtifact(libraryName);
        return {
            "address": libraryAddress,
            "bytecodeHash": hashBytecode(bytecode),
            libraryName
        };
    };

    for (const libraryArtifact of await Promise.
        all(Array.from(libraries.entries()).map(([
            libraryName,
            libraryAddress
        ]) => getLibraryArtifact(
            libraryName,
            libraryAddress
        )))) {
        libraryArtifacts[libraryArtifact.libraryName] = {
            "address": libraryArtifact.address,
            "bytecodeHash": libraryArtifact.bytecodeHash
        };
    }

    return libraryArtifacts;
};

const getLibraryNames = (linkReferences: LinkReferences) => {
    const libraryNames = [];
    for (const key of Object.keys(linkReferences)) {
        const libraryName = Object.keys(linkReferences[key])[0];
        libraryNames.push(libraryName);
    }
    return libraryNames;
};

export const getContractFactory = async (contract: string) => {
    const {linkReferences} = await artifacts.readArtifact(contract);
    if (!Object.keys(linkReferences).length) {
        return await ethers.getContractFactory(contract);
    }

    const libraryNames = getLibraryNames(linkReferences);
    const libraries = await deployLibraries(libraryNames);
    const libraryArtifacts = await getLibraryArtifacts(libraries);

    await updateManifest(libraryArtifacts);

    return await getLinkedContractFactory(
        contract,
        libraries
    );
};
