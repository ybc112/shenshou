// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IRuyiBeastVault {
    function recordFees(
        address token,
        uint256 evolutionAmount,
        uint256 fortuneAmount,
        uint256 riskAmount,
        uint256 rewardAmount,
        uint256 treasuryAmount,
        uint256 burnedAmount
    ) external;

    function processEvolution(address token) external returns (uint256 burnedAmount, uint256 dividendAmount);

    function processAutoDex(address token) external returns (uint256 processedAmount, uint256 buybackOut, uint256 liquidity);

    function payDividend(address to, uint256 amount) external;
}
