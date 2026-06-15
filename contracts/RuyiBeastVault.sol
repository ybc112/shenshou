// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IRuyiBeastToken} from "./interfaces/IRuyiBeastToken.sol";

contract RuyiBeastVault is Ownable, ReentrancyGuard {
    uint16 public constant BPS = 10_000;

    struct PoolBalances {
        uint256 evolution;
        uint256 fortune;
        uint256 risk;
        uint256 reward;
        uint256 treasury;
        uint256 burned;
        uint256 dividendReserve;
        uint256 dividendsDistributed;
        uint256 dividendsPaid;
    }

    struct EvolutionPayoutConfig {
        uint16 burnBps;
        uint16 rewardDividendBps;
    }

    mapping(address => bool) public registeredTokens;
    mapping(address => PoolBalances) public poolBalances;
    mapping(address => EvolutionPayoutConfig) public evolutionPayoutConfigs;

    event TokenRegistered(address indexed token);
    event FeesRecorded(
        address indexed token,
        uint256 evolutionAmount,
        uint256 fortuneAmount,
        uint256 riskAmount,
        uint256 rewardAmount,
        uint256 treasuryAmount,
        uint256 burnedAmount
    );
    event EvolutionPayoutConfigUpdated(address indexed token, uint16 burnBps, uint16 rewardDividendBps);
    event EvolutionProcessed(address indexed token, uint256 burnedAmount, uint256 dividendAmount);
    event DividendPaid(address indexed token, address indexed to, uint256 amount);
    event TreasuryPoolWithdrawn(address indexed token, address indexed to, uint256 amount);
    event OperationalPoolWithdrawn(address indexed token, address indexed to, uint8 poolType, uint256 amount);

    constructor(address initialOwner) Ownable(initialOwner) {}

    modifier onlyRegisteredToken(address token) {
        require(registeredTokens[token], "RuyiVault: token not registered");
        _;
    }

    function registerToken(address token) external onlyOwner {
        require(token != address(0), "RuyiVault: zero token");
        require(!registeredTokens[token], "RuyiVault: already registered");

        registeredTokens[token] = true;
        evolutionPayoutConfigs[token] = EvolutionPayoutConfig({burnBps: 5_000, rewardDividendBps: 5_000});

        emit TokenRegistered(token);
        emit EvolutionPayoutConfigUpdated(token, 5_000, 5_000);
    }

    function setEvolutionPayoutConfig(
        address token,
        uint16 burnBps,
        uint16 rewardDividendBps
    ) external onlyOwner onlyRegisteredToken(token) {
        require(burnBps <= BPS, "RuyiVault: invalid burn bps");
        require(rewardDividendBps <= BPS, "RuyiVault: invalid reward bps");

        evolutionPayoutConfigs[token] = EvolutionPayoutConfig({
            burnBps: burnBps,
            rewardDividendBps: rewardDividendBps
        });

        emit EvolutionPayoutConfigUpdated(token, burnBps, rewardDividendBps);
    }

    function recordFees(
        address token,
        uint256 evolutionAmount,
        uint256 fortuneAmount,
        uint256 riskAmount,
        uint256 rewardAmount,
        uint256 treasuryAmount,
        uint256 burnedAmount
    ) external onlyRegisteredToken(token) {
        require(msg.sender == token, "RuyiVault: only token");

        PoolBalances storage balances = poolBalances[token];
        balances.evolution += evolutionAmount;
        balances.fortune += fortuneAmount;
        balances.risk += riskAmount;
        balances.reward += rewardAmount;
        balances.treasury += treasuryAmount;
        balances.burned += burnedAmount;

        emit FeesRecorded(
            token,
            evolutionAmount,
            fortuneAmount,
            riskAmount,
            rewardAmount,
            treasuryAmount,
            burnedAmount
        );
    }

    function processEvolution(
        address token
    ) external nonReentrant onlyRegisteredToken(token) returns (uint256 burnedAmount, uint256 dividendAmount) {
        require(msg.sender == token, "RuyiVault: only token");

        PoolBalances storage balances = poolBalances[token];
        EvolutionPayoutConfig memory config = evolutionPayoutConfigs[token];

        burnedAmount = (balances.evolution * config.burnBps) / BPS;
        dividendAmount = (balances.reward * config.rewardDividendBps) / BPS;

        if (burnedAmount > 0) {
            balances.evolution -= burnedAmount;
            balances.burned += burnedAmount;
            IRuyiBeastToken(token).burnFromVault(burnedAmount);
        }

        if (dividendAmount > 0) {
            balances.reward -= dividendAmount;
            balances.dividendReserve += dividendAmount;
            balances.dividendsDistributed += dividendAmount;
            IRuyiBeastToken(token).notifyVaultDividend(dividendAmount);
        }

        emit EvolutionProcessed(token, burnedAmount, dividendAmount);
    }

    function payDividend(address to, uint256 amount) external nonReentrant onlyRegisteredToken(msg.sender) {
        require(to != address(0), "RuyiVault: zero recipient");
        require(amount > 0, "RuyiVault: zero amount");

        PoolBalances storage balances = poolBalances[msg.sender];
        require(balances.dividendReserve >= amount, "RuyiVault: insufficient reserve");

        balances.dividendReserve -= amount;
        balances.dividendsPaid += amount;

        require(IERC20(msg.sender).transfer(to, amount), "RuyiVault: transfer failed");

        emit DividendPaid(msg.sender, to, amount);
    }

    function withdrawTreasuryPool(
        address token,
        address to,
        uint256 amount
    ) external onlyOwner nonReentrant onlyRegisteredToken(token) {
        require(to != address(0), "RuyiVault: zero recipient");

        PoolBalances storage balances = poolBalances[token];
        require(balances.treasury >= amount, "RuyiVault: insufficient treasury");

        balances.treasury -= amount;
        require(IERC20(token).transfer(to, amount), "RuyiVault: transfer failed");

        emit TreasuryPoolWithdrawn(token, to, amount);
    }

    function withdrawOperationalPool(
        address token,
        address to,
        uint8 poolType,
        uint256 amount
    ) external onlyOwner nonReentrant onlyRegisteredToken(token) {
        require(to != address(0), "RuyiVault: zero recipient");

        PoolBalances storage balances = poolBalances[token];
        if (poolType == 1) {
            require(balances.fortune >= amount, "RuyiVault: insufficient fortune");
            balances.fortune -= amount;
        } else if (poolType == 2) {
            require(balances.risk >= amount, "RuyiVault: insufficient risk");
            balances.risk -= amount;
        } else {
            revert("RuyiVault: invalid pool type");
        }

        require(IERC20(token).transfer(to, amount), "RuyiVault: transfer failed");

        emit OperationalPoolWithdrawn(token, to, poolType, amount);
    }
}
