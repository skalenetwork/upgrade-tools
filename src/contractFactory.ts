import {artifacts, ethers} from "hardhat";
import {promises as fs} from "fs";
import {hashBytecode} from "@openzeppelin/upgrades-core";
import {LinkReferences} from "hardhat/types";
import {SkaleManifestData} from "./types/SkaleManifestData";
import {
    deployLibraries,
    getLinkedContractFactory,
    getManifestFile
} from "./deploy";


const getSkaleManifest = async () => {
    const manifest = JSON.parse(await fs.readFile(
        await getManifestFile(),
        "utf-8"
    ));
    if (manifest.libraries === undefined) {
        manifest.libraries = {};
    }
    return manifest as SkaleManifestData;
};

const updateManifest = async (
    manifest: SkaleManifestData,
    libraries: Map<string, string>,
    oldLibraries: {[k: string]: string}
) => {
    for (const [
        libraryName,
        libraryAddress
    ] of libraries.entries()) {
        const {bytecode} = await artifacts.readArtifact(libraryName);
        manifest.libraries[libraryName] = {
            "address": libraryAddress,
            "bytecodeHash": hashBytecode(bytecode)
        };
    }
    Object.assign(
        libraries,
        oldLibraries
    );
    await fs.writeFile(
        await getManifestFile(),
        JSON.stringify(
            manifest,
            null,
            4
        )
    );
};

export const getContractFactoryAndUpdateManifest = async (contract: string) => {
    const {linkReferences} = await artifacts.readArtifact(contract);
    if (!Object.keys(linkReferences).length) {
        return await ethers.getContractFactory(contract);
    }

    const manifest = await getSkaleManifest();

    const {
        librariesToUpgrade,
        oldLibraries
    } = await getLibrariesToUpgrade(
        manifest,
        linkReferences
    );
    const libraries = await deployLibraries(librariesToUpgrade);
    await updateManifest(
        manifest,
        libraries,
        oldLibraries
    );
    return await getLinkedContractFactory(
        contract,
        libraries
    );
};

const getLibrariesNames =
    (linkReferences: LinkReferences) => Object.values(linkReferences).
        map((libraryObject) => Object.keys(libraryObject)[0]);


const getLibrariesToUpgrade = async (
    manifest: SkaleManifestData,
    linkReferences: LinkReferences
) => {
    const librariesToUpgrade = [];
    const oldLibraries: {[k: string]: string} = {};
    for (const libraryName of getLibrariesNames(linkReferences)) {
        const {bytecode} = await artifacts.readArtifact(libraryName);
        if (manifest.libraries[libraryName] === undefined) {
            librariesToUpgrade.push(libraryName);
        } else if (
            hashBytecode(bytecode) !== manifest.libraries[libraryName].
                bytecodeHash
        ) {
            librariesToUpgrade.push(libraryName);
        } else {
            oldLibraries[libraryName] =
                    manifest.libraries[libraryName].address;
        }
    }
    return {
        librariesToUpgrade,
        oldLibraries
    };
};
