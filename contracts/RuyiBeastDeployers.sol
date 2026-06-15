// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {RuyiBeastSaleVault} from "./RuyiBeastSaleVault.sol";
import {RuyiBeastToken} from "./RuyiBeastToken.sol";

contract RuyiBeastTokenDeployer {
    function deployToken(
        string memory tokenName,
        string memory tokenSymbol,
        uint256 initialSupply,
        address initialOwner,
        address vault,
        address launchpad,
        uint256 projectId,
        string memory beastName,
        string memory metadataURI,
        uint256 auraThreshold
    ) external returns (address token) {
        token = address(
            new RuyiBeastToken(
                tokenName,
                tokenSymbol,
                initialSupply,
                initialOwner,
                vault,
                launchpad,
                projectId,
                beastName,
                metadataURI,
                auraThreshold
            )
        );
    }
}

contract RuyiBeastSaleVaultDeployer {
    function deploySaleVault(
        address token,
        address creator,
        address fundsReceiver,
        uint256 saleSupply,
        uint256 mintPrice,
        uint256 maxMintPerWallet,
        uint256 saleDeadline
    ) external returns (address saleVault) {
        saleVault = address(
            new RuyiBeastSaleVault(
                token,
                creator,
                fundsReceiver,
                saleSupply,
                mintPrice,
                maxMintPerWallet,
                saleDeadline
            )
        );
    }
}
