// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IRuyiBeastToken} from "./interfaces/IRuyiBeastToken.sol";

interface IRuyiDexRouter {
    function WETH() external view returns (address);

    function swapExactETHForTokensSupportingFeeOnTransferTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable;

    function swapExactTokensForETHSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external;

    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external;

    function addLiquidityETH(
        address token,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    ) external payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity);

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external returns (uint256 amountA, uint256 amountB, uint256 liquidity);
}

contract RuyiBeastVault is Ownable, ReentrancyGuard {
    uint16 public constant BPS = 10_000;
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

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

    struct RewardConfig {
        uint16 talismanChanceBps;
        uint16 talismanPrizeBps;
        uint16 luckyPrizeBps;
        uint16 luckyModulo;
        uint256 minHoldAmount;
        bool enabled;
    }

    struct DexConfig {
        address router;
        address pairedToken;
        address pair;
        address liquidityReceiver;
        address buybackRecipient;
        bool nativePair;
        bool burnBuyback;
        bool enabled;
        uint16 autoBuybackBps;
        uint16 autoLiquidityBps;
        uint256 autoProcessThreshold;
        uint256 autoProcessLimit;
    }

    mapping(address => bool) public registeredTokens;
    mapping(address => PoolBalances) public poolBalances;
    mapping(address => EvolutionPayoutConfig) public evolutionPayoutConfigs;
    mapping(address => RewardConfig) public rewardConfigs;
    mapping(address => DexConfig) public dexConfigs;

    mapping(address => uint256) public talismanRound;
    mapping(address => mapping(uint256 => mapping(address => bool))) public talismanRewardClaimed;
    mapping(address => uint256) public luckyRound;
    mapping(address => mapping(uint256 => uint16)) public luckyWinningNumbers;
    mapping(address => mapping(uint256 => mapping(address => bool))) public luckyRewardClaimed;
    mapping(address => mapping(address => bool)) public hasLuckyNumber;
    mapping(address => mapping(address => uint16)) public luckyNumbers;

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
    event RewardConfigUpdated(
        address indexed token,
        uint16 talismanChanceBps,
        uint16 talismanPrizeBps,
        uint16 luckyPrizeBps,
        uint16 luckyModulo,
        uint256 minHoldAmount,
        bool enabled
    );
    event RewardRoundOpened(address indexed token, uint256 talismanRound, uint256 luckyRound, uint16 luckyWinningNumber);
    event TalismanRewardClaimed(
        address indexed token,
        address indexed account,
        uint256 indexed round,
        bool won,
        uint16 roll,
        uint256 amount
    );
    event LuckyNumberAssigned(address indexed token, address indexed account, uint16 number);
    event LuckyNumberRewardClaimed(
        address indexed token,
        address indexed account,
        uint256 indexed round,
        uint16 number,
        uint256 amount
    );
    event DexConfigUpdated(
        address indexed token,
        address indexed router,
        address pairedToken,
        address pair,
        address liquidityReceiver,
        address buybackRecipient,
        bool nativePair,
        bool burnBuyback,
        bool enabled
    );
    event DexAutomationUpdated(
        address indexed token,
        uint16 autoBuybackBps,
        uint16 autoLiquidityBps,
        uint256 autoProcessThreshold,
        uint256 autoProcessLimit
    );
    event DexBuybackExecuted(address indexed token, address indexed router, uint256 amountIn, uint256 amountOut);
    event DexLiquidityAdded(
        address indexed token,
        address indexed router,
        uint256 tokenAmount,
        uint256 pairedAmount,
        uint256 liquidity
    );
    event DexAutoProcessed(
        address indexed token,
        uint256 processedAmount,
        uint256 buybackPairedAmount,
        uint256 buybackOut,
        uint256 liquidityTokenAmount,
        uint256 liquidityPairedAmount,
        uint256 liquidity
    );
    event NativeWithdrawn(address indexed to, uint256 amount);
    event ExternalTokenWithdrawn(address indexed token, address indexed to, uint256 amount);

    constructor(address initialOwner) Ownable(initialOwner) {}

    receive() external payable {}

    modifier onlyRegisteredToken(address token) {
        require(registeredTokens[token], "RuyiVault: token not registered");
        _;
    }

    function registerToken(address token) external onlyOwner {
        require(token != address(0), "RuyiVault: zero token");
        require(!registeredTokens[token], "RuyiVault: already registered");

        registeredTokens[token] = true;
        evolutionPayoutConfigs[token] = EvolutionPayoutConfig({burnBps: 5_000, rewardDividendBps: 5_000});
        rewardConfigs[token] = RewardConfig({
            talismanChanceBps: 1_000,
            talismanPrizeBps: 1_000,
            luckyPrizeBps: 1_000,
            luckyModulo: 10_000,
            minHoldAmount: 1,
            enabled: true
        });

        emit TokenRegistered(token);
        emit EvolutionPayoutConfigUpdated(token, 5_000, 5_000);
        emit RewardConfigUpdated(token, 1_000, 1_000, 1_000, 10_000, 1, true);
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

    function setRewardConfig(
        address token,
        uint16 talismanChanceBps,
        uint16 talismanPrizeBps,
        uint16 luckyPrizeBps,
        uint16 luckyModulo,
        uint256 minHoldAmount,
        bool enabled
    ) external onlyOwner onlyRegisteredToken(token) {
        require(talismanChanceBps <= BPS, "RuyiVault: invalid chance");
        require(talismanPrizeBps <= BPS, "RuyiVault: invalid talisman prize");
        require(luckyPrizeBps <= BPS, "RuyiVault: invalid lucky prize");
        require(luckyModulo > 0, "RuyiVault: zero modulo");

        rewardConfigs[token] = RewardConfig({
            talismanChanceBps: talismanChanceBps,
            talismanPrizeBps: talismanPrizeBps,
            luckyPrizeBps: luckyPrizeBps,
            luckyModulo: luckyModulo,
            minHoldAmount: minHoldAmount,
            enabled: enabled
        });

        emit RewardConfigUpdated(
            token,
            talismanChanceBps,
            talismanPrizeBps,
            luckyPrizeBps,
            luckyModulo,
            minHoldAmount,
            enabled
        );
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

        _openRewardRound(token);

        emit EvolutionProcessed(token, burnedAmount, dividendAmount);
    }

    function openRewardRound(address token) external onlyOwner onlyRegisteredToken(token) returns (uint256 round) {
        round = _openRewardRound(token);
    }

    function assignLuckyNumber(
        address token,
        address account
    ) external onlyOwner onlyRegisteredToken(token) returns (uint16 number) {
        require(account != address(0), "RuyiVault: zero account");

        RewardConfig memory config = rewardConfigs[token];
        require(config.enabled, "RuyiVault: rewards disabled");
        require(IERC20(token).balanceOf(account) >= config.minHoldAmount, "RuyiVault: insufficient holding");

        if (hasLuckyNumber[token][account]) {
            return luckyNumbers[token][account];
        }

        number = uint16(_random(token, account, luckyRound[token] + 1, "LUCKY_NUMBER") % config.luckyModulo);
        hasLuckyNumber[token][account] = true;
        luckyNumbers[token][account] = number;

        emit LuckyNumberAssigned(token, account, number);
    }

    function claimTalismanReward(
        address token,
        address account
    ) external onlyOwner nonReentrant onlyRegisteredToken(token) returns (bool won, uint256 amount, uint16 roll) {
        require(account != address(0), "RuyiVault: zero account");

        RewardConfig memory config = rewardConfigs[token];
        require(config.enabled, "RuyiVault: rewards disabled");
        require(IERC20(token).balanceOf(account) >= config.minHoldAmount, "RuyiVault: insufficient holding");

        uint256 round = talismanRound[token];
        require(round > 0, "RuyiVault: no reward round");
        require(!talismanRewardClaimed[token][round][account], "RuyiVault: talisman claimed");
        talismanRewardClaimed[token][round][account] = true;

        roll = uint16(_random(token, account, round, "TALISMAN") % BPS);
        won = roll < config.talismanChanceBps;

        PoolBalances storage balances = poolBalances[token];
        if (won && balances.fortune > 0 && config.talismanPrizeBps > 0) {
            amount = (balances.fortune * config.talismanPrizeBps) / BPS;
            if (amount == 0) {
                amount = balances.fortune;
            }

            balances.fortune -= amount;
            require(IERC20(token).transfer(account, amount), "RuyiVault: transfer failed");
        }

        emit TalismanRewardClaimed(token, account, round, won, roll, amount);
    }

    function claimLuckyNumberReward(
        address token,
        address account,
        uint256 round
    ) external onlyOwner nonReentrant onlyRegisteredToken(token) returns (uint256 amount) {
        require(account != address(0), "RuyiVault: zero account");
        require(round > 0 && round <= luckyRound[token], "RuyiVault: invalid round");
        require(hasLuckyNumber[token][account], "RuyiVault: no lucky number");
        require(!luckyRewardClaimed[token][round][account], "RuyiVault: lucky claimed");

        RewardConfig memory config = rewardConfigs[token];
        require(config.enabled, "RuyiVault: rewards disabled");
        require(IERC20(token).balanceOf(account) >= config.minHoldAmount, "RuyiVault: insufficient holding");

        uint16 number = luckyNumbers[token][account];
        require(number == luckyWinningNumbers[token][round], "RuyiVault: number mismatch");

        luckyRewardClaimed[token][round][account] = true;

        PoolBalances storage balances = poolBalances[token];
        require(balances.risk > 0, "RuyiVault: empty risk pool");

        amount = (balances.risk * config.luckyPrizeBps) / BPS;
        if (amount == 0) {
            amount = balances.risk;
        }

        balances.risk -= amount;
        require(IERC20(token).transfer(account, amount), "RuyiVault: transfer failed");

        emit LuckyNumberRewardClaimed(token, account, round, number, amount);
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

    function setDexConfig(
        address token,
        address router,
        address pairedToken,
        address pair,
        address liquidityReceiver,
        address buybackRecipient,
        bool nativePair,
        bool burnBuyback,
        bool enabled
    ) external onlyOwner onlyRegisteredToken(token) {
        if (enabled) {
            require(router != address(0), "RuyiVault: zero router");
            require(liquidityReceiver != address(0), "RuyiVault: zero lp receiver");
            require(burnBuyback || buybackRecipient != address(0), "RuyiVault: zero buyback recipient");
            if (!nativePair) {
                require(pairedToken != address(0), "RuyiVault: zero paired token");
            }
        }

        DexConfig memory previous = dexConfigs[token];
        dexConfigs[token] = DexConfig({
            router: router,
            pairedToken: pairedToken,
            pair: pair,
            liquidityReceiver: liquidityReceiver,
            buybackRecipient: burnBuyback ? DEAD : buybackRecipient,
            nativePair: nativePair,
            burnBuyback: burnBuyback,
            enabled: enabled,
            autoBuybackBps: previous.autoBuybackBps,
            autoLiquidityBps: previous.autoLiquidityBps,
            autoProcessThreshold: previous.autoProcessThreshold,
            autoProcessLimit: previous.autoProcessLimit
        });

        emit DexConfigUpdated(
            token,
            router,
            pairedToken,
            pair,
            liquidityReceiver,
            burnBuyback ? DEAD : buybackRecipient,
            nativePair,
            burnBuyback,
            enabled
        );
    }

    function setDexAutomationConfig(
        address token,
        uint16 autoBuybackBps,
        uint16 autoLiquidityBps,
        uint256 autoProcessThreshold,
        uint256 autoProcessLimit
    ) external onlyOwner onlyRegisteredToken(token) {
        require(uint256(autoBuybackBps) + autoLiquidityBps <= BPS, "RuyiVault: invalid auto bps");
        if (autoProcessThreshold > 0) {
            require(autoBuybackBps > 0 || autoLiquidityBps > 0, "RuyiVault: zero auto split");
        }

        DexConfig storage config = dexConfigs[token];
        config.autoBuybackBps = autoBuybackBps;
        config.autoLiquidityBps = autoLiquidityBps;
        config.autoProcessThreshold = autoProcessThreshold;
        config.autoProcessLimit = autoProcessLimit;

        emit DexAutomationUpdated(token, autoBuybackBps, autoLiquidityBps, autoProcessThreshold, autoProcessLimit);
    }

    function executeNativeBuyback(
        address token,
        uint256 amountOutMin,
        uint256 deadline
    ) external payable onlyOwner nonReentrant onlyRegisteredToken(token) returns (uint256 amountOut) {
        DexConfig memory config = _requireDexConfig(token);
        require(config.nativePair, "RuyiVault: not native pair");
        require(msg.value > 0, "RuyiVault: zero native");

        address[] memory path = new address[](2);
        path[0] = IRuyiDexRouter(config.router).WETH();
        path[1] = token;

        uint256 balanceBefore = IERC20(token).balanceOf(config.buybackRecipient);
        IRuyiDexRouter(config.router).swapExactETHForTokensSupportingFeeOnTransferTokens{value: msg.value}(
            amountOutMin,
            path,
            config.buybackRecipient,
            deadline
        );
        amountOut = IERC20(token).balanceOf(config.buybackRecipient) - balanceBefore;

        emit DexBuybackExecuted(token, config.router, msg.value, amountOut);
    }

    function executeTokenBuyback(
        address token,
        uint256 amountIn,
        uint256 amountOutMin,
        uint256 deadline
    ) external onlyOwner nonReentrant onlyRegisteredToken(token) returns (uint256 amountOut) {
        DexConfig memory config = _requireDexConfig(token);
        require(!config.nativePair, "RuyiVault: native pair");
        require(amountIn > 0, "RuyiVault: zero amount");
        require(IERC20(config.pairedToken).balanceOf(address(this)) >= amountIn, "RuyiVault: insufficient paired");

        address[] memory path = new address[](2);
        path[0] = config.pairedToken;
        path[1] = token;

        _approve(config.pairedToken, config.router, amountIn);
        uint256 balanceBefore = IERC20(token).balanceOf(config.buybackRecipient);
        IRuyiDexRouter(config.router).swapExactTokensForTokensSupportingFeeOnTransferTokens(
            amountIn,
            amountOutMin,
            path,
            config.buybackRecipient,
            deadline
        );
        amountOut = IERC20(token).balanceOf(config.buybackRecipient) - balanceBefore;

        emit DexBuybackExecuted(token, config.router, amountIn, amountOut);
    }

    function executeAddLiquidityNative(
        address token,
        uint256 tokenAmount,
        uint256 amountTokenMin,
        uint256 amountNativeMin,
        uint256 deadline
    )
        external
        payable
        onlyOwner
        nonReentrant
        onlyRegisteredToken(token)
        returns (uint256 amountToken, uint256 amountNative, uint256 liquidity)
    {
        DexConfig memory config = _requireDexConfig(token);
        require(config.nativePair, "RuyiVault: not native pair");
        require(tokenAmount > 0, "RuyiVault: zero token amount");
        require(msg.value > 0, "RuyiVault: zero native");

        PoolBalances storage balances = poolBalances[token];
        require(balances.treasury >= tokenAmount, "RuyiVault: insufficient treasury");

        _approve(token, config.router, tokenAmount);
        (amountToken, amountNative, liquidity) = IRuyiDexRouter(config.router).addLiquidityETH{value: msg.value}(
            token,
            tokenAmount,
            amountTokenMin,
            amountNativeMin,
            config.liquidityReceiver,
            deadline
        );
        balances.treasury -= amountToken;

        emit DexLiquidityAdded(token, config.router, amountToken, amountNative, liquidity);
    }

    function executeAddLiquidityToken(
        address token,
        uint256 tokenAmount,
        uint256 pairedAmount,
        uint256 amountTokenMin,
        uint256 amountPairedMin,
        uint256 deadline
    )
        external
        onlyOwner
        nonReentrant
        onlyRegisteredToken(token)
        returns (uint256 amountToken, uint256 amountPaired, uint256 liquidity)
    {
        DexConfig memory config = _requireDexConfig(token);
        require(!config.nativePair, "RuyiVault: native pair");
        require(tokenAmount > 0 && pairedAmount > 0, "RuyiVault: zero amount");
        require(IERC20(config.pairedToken).balanceOf(address(this)) >= pairedAmount, "RuyiVault: insufficient paired");

        PoolBalances storage balances = poolBalances[token];
        require(balances.treasury >= tokenAmount, "RuyiVault: insufficient treasury");

        _approve(token, config.router, tokenAmount);
        _approve(config.pairedToken, config.router, pairedAmount);
        (amountToken, amountPaired, liquidity) = IRuyiDexRouter(config.router).addLiquidity(
            token,
            config.pairedToken,
            tokenAmount,
            pairedAmount,
            amountTokenMin,
            amountPairedMin,
            config.liquidityReceiver,
            deadline
        );
        balances.treasury -= amountToken;

        emit DexLiquidityAdded(token, config.router, amountToken, amountPaired, liquidity);
    }

    function processAutoDex(
        address token
    )
        external
        nonReentrant
        onlyRegisteredToken(token)
        returns (uint256 processedAmount, uint256 buybackOut, uint256 liquidity)
    {
        require(msg.sender == token || msg.sender == owner(), "RuyiVault: not auto caller");

        DexConfig memory config = dexConfigs[token];
        uint256 splitBps = uint256(config.autoBuybackBps) + config.autoLiquidityBps;
        if (
            !config.enabled ||
            config.router == address(0) ||
            config.autoProcessThreshold == 0 ||
            splitBps == 0
        ) {
            return (0, 0, 0);
        }

        PoolBalances storage balances = poolBalances[token];
        if (balances.treasury < config.autoProcessThreshold) {
            return (0, 0, 0);
        }

        processedAmount = balances.treasury;
        if (config.autoProcessLimit > 0 && processedAmount > config.autoProcessLimit) {
            processedAmount = config.autoProcessLimit;
        }
        if (processedAmount == 0) {
            return (0, 0, 0);
        }

        uint256 liquidityTokenWeight =
            (processedAmount * config.autoLiquidityBps) / splitBps;
        uint256 liquidityTokenAmount = liquidityTokenWeight / 2;
        if (config.autoBuybackBps == 0 && liquidityTokenAmount == 0) {
            return (0, 0, 0);
        }

        uint256 pairedSwapTokenAmount = processedAmount - liquidityTokenAmount;
        if (pairedSwapTokenAmount == 0) {
            return (0, 0, 0);
        }

        balances.treasury -= processedAmount;

        uint256 pairedReceived = config.nativePair
            ? _swapTokensForNative(token, config.router, pairedSwapTokenAmount)
            : _swapTokensForPaired(token, config.pairedToken, config.router, pairedSwapTokenAmount);
        require(pairedReceived > 0, "RuyiVault: zero paired output");

        uint256 liquidityPairedAmount;
        uint256 buybackPairedAmount = pairedReceived;

        if (liquidityTokenAmount > 0 && config.autoLiquidityBps > 0 && pairedReceived > 0) {
            uint256 liquiditySwapTokenAmount = liquidityTokenWeight - liquidityTokenAmount;
            liquidityPairedAmount = (pairedReceived * liquiditySwapTokenAmount) / pairedSwapTokenAmount;
            buybackPairedAmount = pairedReceived - liquidityPairedAmount;
            if (config.autoBuybackBps == 0) {
                require(liquidityPairedAmount > 0, "RuyiVault: zero liquidity pair amount");
            }

            if (liquidityPairedAmount > 0) {
                uint256 usedTokenAmount;
                if (config.nativePair) {
                    (usedTokenAmount, , liquidity) = _addAutoLiquidityNative(
                        token,
                        config.router,
                        liquidityTokenAmount,
                        liquidityPairedAmount,
                        config.liquidityReceiver
                    );
                } else {
                    (usedTokenAmount, , liquidity) = _addAutoLiquidityToken(
                        token,
                        config.pairedToken,
                        config.router,
                        liquidityTokenAmount,
                        liquidityPairedAmount,
                        config.liquidityReceiver
                    );
                }

                require(liquidity > 0, "RuyiVault: zero liquidity");
                if (usedTokenAmount < liquidityTokenAmount) {
                    balances.treasury += liquidityTokenAmount - usedTokenAmount;
                }
            } else {
                balances.treasury += liquidityTokenAmount;
            }
        } else if (liquidityTokenAmount > 0) {
            balances.treasury += liquidityTokenAmount;
        }

        if (buybackPairedAmount > 0 && config.autoBuybackBps > 0) {
            buybackOut = config.nativePair
                ? _buybackWithNative(token, config.router, buybackPairedAmount, config.buybackRecipient)
                : _buybackWithPaired(
                    token,
                    config.pairedToken,
                    config.router,
                    buybackPairedAmount,
                    config.buybackRecipient
                );
            require(buybackOut > 0, "RuyiVault: zero buyback output");
        }

        emit DexAutoProcessed(
            token,
            processedAmount,
            buybackPairedAmount,
            buybackOut,
            liquidityTokenAmount,
            liquidityPairedAmount,
            liquidity
        );
    }

    function withdrawNative(address payable to, uint256 amount) external onlyOwner nonReentrant {
        require(to != address(0), "RuyiVault: zero recipient");
        require(address(this).balance >= amount, "RuyiVault: insufficient native");

        (bool ok, ) = to.call{value: amount}("");
        require(ok, "RuyiVault: native transfer failed");

        emit NativeWithdrawn(to, amount);
    }

    function withdrawExternalToken(address token, address to, uint256 amount) external onlyOwner nonReentrant {
        require(!registeredTokens[token], "RuyiVault: registered token");
        require(to != address(0), "RuyiVault: zero recipient");

        require(IERC20(token).transfer(to, amount), "RuyiVault: transfer failed");

        emit ExternalTokenWithdrawn(token, to, amount);
    }

    function _swapTokensForNative(
        address token,
        address router,
        uint256 tokenAmount
    ) private returns (uint256 nativeReceived) {
        uint256 nativeBefore = address(this).balance;
        address[] memory path = new address[](2);
        path[0] = token;
        path[1] = IRuyiDexRouter(router).WETH();

        _approve(token, router, tokenAmount);
        IRuyiDexRouter(router).swapExactTokensForETHSupportingFeeOnTransferTokens(
            tokenAmount,
            0,
            path,
            address(this),
            block.timestamp
        );

        nativeReceived = address(this).balance - nativeBefore;
    }

    function _swapTokensForPaired(
        address token,
        address pairedToken,
        address router,
        uint256 tokenAmount
    ) private returns (uint256 pairedReceived) {
        uint256 pairedBefore = IERC20(pairedToken).balanceOf(address(this));
        address[] memory path = new address[](2);
        path[0] = token;
        path[1] = pairedToken;

        _approve(token, router, tokenAmount);
        IRuyiDexRouter(router).swapExactTokensForTokensSupportingFeeOnTransferTokens(
            tokenAmount,
            0,
            path,
            address(this),
            block.timestamp
        );

        pairedReceived = IERC20(pairedToken).balanceOf(address(this)) - pairedBefore;
    }

    function _addAutoLiquidityNative(
        address token,
        address router,
        uint256 tokenAmount,
        uint256 nativeAmount,
        address receiver
    ) private returns (uint256 amountToken, uint256 amountNative, uint256 liquidity) {
        _approve(token, router, tokenAmount);
        (amountToken, amountNative, liquidity) = IRuyiDexRouter(router).addLiquidityETH{value: nativeAmount}(
            token,
            tokenAmount,
            0,
            0,
            receiver,
            block.timestamp
        );
    }

    function _addAutoLiquidityToken(
        address token,
        address pairedToken,
        address router,
        uint256 tokenAmount,
        uint256 pairedAmount,
        address receiver
    ) private returns (uint256 amountToken, uint256 amountPaired, uint256 liquidity) {
        _approve(token, router, tokenAmount);
        _approve(pairedToken, router, pairedAmount);
        (amountToken, amountPaired, liquidity) = IRuyiDexRouter(router).addLiquidity(
            token,
            pairedToken,
            tokenAmount,
            pairedAmount,
            0,
            0,
            receiver,
            block.timestamp
        );
    }

    function _buybackWithNative(
        address token,
        address router,
        uint256 nativeAmount,
        address recipient
    ) private returns (uint256 amountOut) {
        uint256 balanceBefore = IERC20(token).balanceOf(recipient);
        address[] memory path = new address[](2);
        path[0] = IRuyiDexRouter(router).WETH();
        path[1] = token;

        IRuyiDexRouter(router).swapExactETHForTokensSupportingFeeOnTransferTokens{value: nativeAmount}(
            0,
            path,
            recipient,
            block.timestamp
        );

        amountOut = IERC20(token).balanceOf(recipient) - balanceBefore;
    }

    function _buybackWithPaired(
        address token,
        address pairedToken,
        address router,
        uint256 pairedAmount,
        address recipient
    ) private returns (uint256 amountOut) {
        uint256 balanceBefore = IERC20(token).balanceOf(recipient);
        address[] memory path = new address[](2);
        path[0] = pairedToken;
        path[1] = token;

        _approve(pairedToken, router, pairedAmount);
        IRuyiDexRouter(router).swapExactTokensForTokensSupportingFeeOnTransferTokens(
            pairedAmount,
            0,
            path,
            recipient,
            block.timestamp
        );

        amountOut = IERC20(token).balanceOf(recipient) - balanceBefore;
    }

    function _openRewardRound(address token) private returns (uint256 round) {
        RewardConfig memory config = rewardConfigs[token];
        require(config.luckyModulo > 0, "RuyiVault: reward config missing");
        if (!config.enabled) {
            return talismanRound[token];
        }

        round = talismanRound[token] + 1;
        talismanRound[token] = round;
        luckyRound[token] += 1;

        uint16 winningNumber = uint16(_random(token, address(this), luckyRound[token], "LUCKY_DRAW") % config.luckyModulo);
        luckyWinningNumbers[token][luckyRound[token]] = winningNumber;

        emit RewardRoundOpened(token, round, luckyRound[token], winningNumber);
    }

    function _requireDexConfig(address token) private view returns (DexConfig memory config) {
        config = dexConfigs[token];
        require(config.enabled, "RuyiVault: dex disabled");
        require(config.router != address(0), "RuyiVault: zero router");
    }

    function _approve(address token, address spender, uint256 amount) private {
        require(IERC20(token).approve(spender, 0), "RuyiVault: approve reset failed");
        require(IERC20(token).approve(spender, amount), "RuyiVault: approve failed");
    }

    function _random(
        address token,
        address account,
        uint256 nonce,
        string memory salt
    ) private view returns (uint256) {
        return uint256(
            keccak256(
                abi.encodePacked(block.prevrandao, block.timestamp, blockhash(block.number - 1), token, account, nonce, salt)
            )
        );
    }
}
