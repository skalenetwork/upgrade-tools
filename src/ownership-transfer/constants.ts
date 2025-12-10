

export const ERC1967_ADMIN_SLOT = "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103";
export const ERC1967_IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";


export const basicBeaconAbi = [
    "function owner() view returns (address)",
    "function implementation() view returns (address)",
    "function upgradeTo(address newImplementation)"
];

export const OWNABLE_ABI = [
    "function transferOwnership(address newOwner)",
    "function owner() view returns (address)"
];

export const ACCESS_CONTROL_ABI = [
    "function hasRole(bytes32 role, address account) view returns (bool)",
    "function grantRole(bytes32 role, address account)",
    "function renounceRole(bytes32 role, address account)",
    "function getRoleMemberCount(bytes32 role) view returns (uint256)"
];

export const ACCESS_MANAGER_ABI = [
    "function hasRole(uint64 role, address account) view returns (bool)",
    "function grantRole(uint64 role, address account, uint32 executionDelay)",
    "function renounceRole(uint64 role, address account)"
];

export const ACCESS_MANAGED_ABI = [
    "function authority() view returns (address)"
];

export const MULTISIG_ABI = [
    "function getOwners() view returns (address[])",
    "function getThreshold() view returns (uint256)"
];
