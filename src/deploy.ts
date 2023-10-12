import {Manifest, hashBytecode} from "@openzeppelin/upgrades-core";
import {artifacts, ethers} from "hardhat";
import {NonceProvider} from "./nonceProvider";
import {SkaleManifestData} from "./types/SkaleManifestData";
import {promises as fs} from "fs";
import {getLibrariesNames} from "./contractFactory";


interface LibraryArtifacts {
    [key: string]: unknown
}

const deployLibrary = async (
    libraryName: string,
    nonceProvider: NonceProvider
) => {
    const Library = await ethers.getContractFactory(libraryName);
    const library = await Library.
        deploy({"nonce": nonceProvider.reserveNonce()});
    await library.deployed();
    return library.address;
};

export const deployLibraries = async (
    libraryNames: string[],
    nonceProvider?: NonceProvider
) => {
    const [deployer] = await ethers.getSigners();
    const initializedNonceProvider = nonceProvider ??
         await NonceProvider.createForWallet(deployer);
    const libraries = new Map<string, string>();

    (await Promise.all(libraryNames.map((libraryName) => (async () => [
        libraryName,
        await deployLibrary(
            libraryName,
            initializedNonceProvider
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

    return await ethers.getContractFactory(
        contract,
        {"libraries": Object.fromEntries(libraries)}
    );
};
