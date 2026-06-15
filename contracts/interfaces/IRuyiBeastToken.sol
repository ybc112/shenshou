// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IRuyiBeastToken {
    function burnFromVault(uint256 amount) external;

    function notifyVaultDividend(uint256 amount) external;

    function projectId() external view returns (uint256);

    function owner() external view returns (address);
}
