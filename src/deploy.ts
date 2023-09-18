import {Manifest, hashBytecode} from "@openzeppelin/upgrades-core";
import {artifacts, ethers} from "hardhat";
import {promises as fs} from "fs";
import {SkaleManifestData} from "./types/SkaleManifestData";
import {Artifact} from "hardhat/types";
import {hexDataSlice, hexConcat} from "ethers/lib/utils";
import {getLibrariesNames} from "./contractFactory";

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

const firstByteIndex = 0;

const linkBytecode = (artifact: Artifact, libraries: Map<string, string>) => {
    let {bytecode} = artifact;
    for (const [, fileReferences] of Object.entries(artifact.linkReferences)) {
        for (const [
            libName,
            fixups
        ] of Object.entries(fileReferences)) {
            const libAddress = libraries.get(libName);
            if (typeof libAddress !== "undefined") {
                for (const fixup of fixups) {
                    const bytecodeBefore = hexDataSlice(
                        bytecode,
                        firstByteIndex,
                        fixup.start
                    );
                    const bytecodeAfter = hexDataSlice(
                        bytecode,
                        fixup.start + fixup.length
                    );
                    bytecode = hexConcat([
                        bytecodeBefore,
                        libAddress,
                        bytecodeAfter
                    ]);
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
    const linkedBytecode = linkBytecode(
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
    if (typeof manifest.libraries === "undefined") {
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
    const indentation = 4;
    await fs.writeFile(
        await getManifestFile(),
        JSON.stringify(
            manifest,
            null,
            indentation
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

export const getContractFactory = async (contract: string) => {
    const {linkReferences} = await artifacts.readArtifact(contract);
    if (!Object.keys(linkReferences).length) {
        return await ethers.getContractFactory(contract);
    }

    const libraryNames = getLibrariesNames(linkReferences);
    const libraries = await deployLibraries(libraryNames);
    const libraryArtifacts = await getLibraryArtifacts(libraries);

    await updateManifest(libraryArtifacts);

    return await getLinkedContractFactory(
        contract,
        libraries
    );
};
