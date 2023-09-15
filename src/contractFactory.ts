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

const loadBytesCodes = async (libraryNames: string[]) => {
    const byteCodes = new Map<string, string>();

    (await Promise.
        all(libraryNames.map((libraryName) => (async () => {
            const {bytecode} = await artifacts.readArtifact(libraryName);
            return [
                libraryName,
                bytecode
            ];
        })()))).forEach(([
        libraryName,
        bytecode
    ]) => {
        byteCodes.set(
            libraryName,
            bytecode
        );
    });
    return byteCodes;
};

const updateManifest = async (
    manifest: SkaleManifestData,
    libraries: Map<string, string>,
    oldLibraries: {[k: string]: string}
) => {
    const byteCodes = await loadBytesCodes(Array.from(libraries.keys()));
    for (const [
        libraryName,
        libraryAddress
    ] of libraries.entries()) {
        manifest.libraries[libraryName] = {
            "address": libraryAddress,
            "bytecodeHash": hashBytecode(byteCodes.get(libraryName) as string)
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
    const librariesNames = getLibrariesNames(linkReferences);
    const byteCodes = await loadBytesCodes(librariesNames);
    for (const libraryName of librariesNames) {
        if (manifest.libraries[libraryName] === undefined) {
            librariesToUpgrade.push(libraryName);
        } else if (
            hashBytecode(byteCodes.get(libraryName) as string) !==
                manifest.libraries[libraryName].bytecodeHash
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
