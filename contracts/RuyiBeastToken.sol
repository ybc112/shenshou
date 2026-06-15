// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IRuyiBeastVault} from "./interfaces/IRuyiBeastVault.sol";

contract RuyiBeastToken is ERC20, Ownable, ReentrancyGuard {
    uint16 public constant BPS = 10_000;
    uint16 public constant MAX_BUY_TAX_BPS = 500;
    uint16 public constant MAX_SELL_TAX_BPS = 1_000;
    uint16 public constant PLATFORM_TAX_SHARE_BPS = 2_000;
    uint256 private constant MAGNITUDE = 2 ** 128;
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    enum BeastStage {
        Egg,
        Cub,
        Growth,
        Awakened,
        Divine
    }

    struct FeeRates {
        uint16 evolution;
        uint16 fortune;
        uint16 risk;
        uint16 reward;
        uint16 treasury;
        uint16 burn;
    }

    address public immutable vault;
    address public immutable launchpad;
    uint256 public immutable projectId;

    string public beastName;
    string public metadataURI;

    BeastStage public stage;
    uint256 public aura;
    uint256 public auraThreshold;

    FeeRates public buyFees;
    FeeRates public sellFees;

    bool public tradingEnabled;
    bool public controlsLocked;
    uint256 public maxTxAmount;
    uint256 public maxWalletAmount;

    mapping(address => bool) public automatedMarketMakerPairs;
    mapping(address => bool) public isFeeExempt;
    mapping(address => bool) public isTxLimitExempt;

    mapping(address => bool) public excludedFromDividends;
    mapping(address => int256) private _magnifiedDividendCorrections;
    mapping(address => uint256) public withdrawnDividends;

    uint256 public magnifiedDividendPerShare;
    uint256 public totalDividendsDistributed;
    uint256 public totalDividendsClaimed;
    uint256 private _dividendSupply;

    event TradingEnabled();
    event ControlsLocked();
    event FeesUpdated(FeeRates buyFees, FeeRates sellFees);
    event FeeExemptUpdated(address indexed account, bool exempt);
    event TxLimitExemptUpdated(address indexed account, bool exempt);
    event AutomatedMarketMakerPairUpdated(address indexed pair, bool enabled);
    event LimitsUpdated(uint256 maxTxAmount, uint256 maxWalletAmount);
    event MetadataUpdated(string metadataURI);
    event AuraThresholdUpdated(uint256 auraThreshold);
    event FeesTaken(
        address indexed from,
        address indexed to,
        bool indexed isSell,
        uint256 feeAmount,
        uint256 evolutionAmount,
        uint256 rewardAmount
    );
    event BeastEvolved(
        uint256 indexed projectId,
        BeastStage previousStage,
        BeastStage newStage,
        uint256 remainingAura,
        uint256 nextAuraThreshold,
        uint256 burnedAmount,
        uint256 dividendAmount
    );
    event VaultBurned(uint256 amount);
    event DividendsDistributed(uint256 amount);
    event DividendClaimed(address indexed account, uint256 amount);
    event ExcludedFromDividends(address indexed account, bool excluded);

    modifier onlyVault() {
        require(msg.sender == vault, "RuyiToken: only vault");
        _;
    }

    modifier controlsOpen() {
        require(!controlsLocked, "RuyiToken: controls locked");
        _;
    }

    constructor(
        string memory tokenName_,
        string memory tokenSymbol_,
        uint256 initialSupply_,
        address initialOwner_,
        address vault_,
        address launchpad_,
        uint256 projectId_,
        string memory beastName_,
        string memory metadataURI_,
        uint256 auraThreshold_
    ) ERC20(tokenName_, tokenSymbol_) Ownable(initialOwner_) {
        require(initialSupply_ > 0, "RuyiToken: zero supply");
        require(initialOwner_ != address(0), "RuyiToken: zero owner");
        require(vault_ != address(0), "RuyiToken: zero vault");
        require(launchpad_ != address(0), "RuyiToken: zero launchpad");

        vault = vault_;
        launchpad = launchpad_;
        projectId = projectId_;
        beastName = beastName_;
        metadataURI = metadataURI_;
        auraThreshold = auraThreshold_ == 0 ? initialSupply_ / 1_000 : auraThreshold_;

        buyFees = FeeRates({evolution: 150, fortune: 50, risk: 50, reward: 50, treasury: 0, burn: 0});
        sellFees = FeeRates({evolution: 200, fortune: 100, risk: 100, reward: 50, treasury: 50, burn: 0});

        maxTxAmount = initialSupply_ / 100;
        maxWalletAmount = (initialSupply_ * 2) / 100;

        _setFeeExempt(initialOwner_, true);
        _setFeeExempt(vault_, true);
        _setFeeExempt(launchpad_, true);
        _setFeeExempt(address(this), true);

        _setTxLimitExempt(initialOwner_, true);
        _setTxLimitExempt(vault_, true);
        _setTxLimitExempt(launchpad_, true);
        _setTxLimitExempt(address(this), true);

        _setExcludedFromDividends(vault_, true);
        _setExcludedFromDividends(launchpad_, true);
        _setExcludedFromDividends(DEAD, true);
        _setExcludedFromDividends(address(this), true);

        _mint(initialOwner_, initialSupply_);
    }

    function enableTrading() external onlyOwner {
        require(!tradingEnabled, "RuyiToken: trading enabled");
        tradingEnabled = true;
        _lockControls();
        emit TradingEnabled();
    }

    function lockControls() external onlyOwner {
        _lockControls();
    }

    function setFees(FeeRates calldata newBuyFees, FeeRates calldata newSellFees) external onlyOwner controlsOpen {
        require(_totalFeeBps(newBuyFees) <= MAX_BUY_TAX_BPS, "RuyiToken: buy tax too high");
        require(_totalFeeBps(newSellFees) <= MAX_SELL_TAX_BPS, "RuyiToken: sell tax too high");

        buyFees = newBuyFees;
        sellFees = newSellFees;

        emit FeesUpdated(newBuyFees, newSellFees);
    }

    function setAutomatedMarketMakerPair(address pair, bool enabled) external onlyOwner controlsOpen {
        require(pair != address(0), "RuyiToken: zero pair");
        require(automatedMarketMakerPairs[pair] != enabled, "RuyiToken: unchanged");

        automatedMarketMakerPairs[pair] = enabled;
        _setTxLimitExempt(pair, true);
        _setExcludedFromDividends(pair, enabled);

        emit AutomatedMarketMakerPairUpdated(pair, enabled);
    }

    function setFeeExempt(address account, bool exempt) external onlyOwner controlsOpen {
        _setFeeExempt(account, exempt);
    }

    function setTxLimitExempt(address account, bool exempt) external onlyOwner controlsOpen {
        _setTxLimitExempt(account, exempt);
    }

    function setExcludedFromDividends(address account, bool excluded) external onlyOwner controlsOpen {
        _setExcludedFromDividends(account, excluded);
    }

    function setLimits(uint256 newMaxTxAmount, uint256 newMaxWalletAmount) external onlyOwner controlsOpen {
        require(newMaxTxAmount > 0, "RuyiToken: zero max tx");
        require(newMaxWalletAmount >= newMaxTxAmount, "RuyiToken: wallet lt tx");

        maxTxAmount = newMaxTxAmount;
        maxWalletAmount = newMaxWalletAmount;

        emit LimitsUpdated(newMaxTxAmount, newMaxWalletAmount);
    }

    function setAuraThreshold(uint256 newAuraThreshold) external onlyOwner controlsOpen {
        require(newAuraThreshold > 0, "RuyiToken: zero threshold");
        auraThreshold = newAuraThreshold;
        emit AuraThresholdUpdated(newAuraThreshold);
    }

    function setMetadataURI(string calldata newMetadataURI) external onlyOwner {
        metadataURI = newMetadataURI;
        emit MetadataUpdated(newMetadataURI);
    }

    function triggerEvolution() external nonReentrant {
        require(stage != BeastStage.Divine, "RuyiToken: final stage");
        require(aura >= auraThreshold, "RuyiToken: aura not full");

        BeastStage previousStage = stage;
        aura -= auraThreshold;
        stage = BeastStage(uint8(stage) + 1);
        auraThreshold = (auraThreshold * 150) / 100;

        (uint256 burnedAmount, uint256 dividendAmount) = IRuyiBeastVault(vault).processEvolution(address(this));

        emit BeastEvolved(projectId, previousStage, stage, aura, auraThreshold, burnedAmount, dividendAmount);
    }

    function burnFromVault(uint256 amount) external onlyVault {
        require(amount > 0, "RuyiToken: zero burn");
        _rawUpdate(vault, address(0), amount);
        emit VaultBurned(amount);
    }

    function notifyVaultDividend(uint256 amount) external onlyVault {
        require(amount > 0, "RuyiToken: zero dividend");

        uint256 supplyForDividends = _dividendSupply;
        if (supplyForDividends == 0) {
            return;
        }

        magnifiedDividendPerShare += (amount * MAGNITUDE) / supplyForDividends;
        totalDividendsDistributed += amount;

        emit DividendsDistributed(amount);
    }

    function claimDividends() external nonReentrant returns (uint256 amount) {
        require(!excludedFromDividends[msg.sender], "RuyiToken: excluded");

        amount = withdrawableDividendOf(msg.sender);
        require(amount > 0, "RuyiToken: no dividends");

        withdrawnDividends[msg.sender] += amount;
        totalDividendsClaimed += amount;

        IRuyiBeastVault(vault).payDividend(msg.sender, amount);

        emit DividendClaimed(msg.sender, amount);
    }

    function dividendSupply() external view returns (uint256) {
        return _dividendSupply;
    }

    function totalFeeBps(bool sell) external view returns (uint256) {
        return _totalFeeBps(sell ? sellFees : buyFees);
    }

    function withdrawableDividendOf(address account) public view returns (uint256) {
        uint256 accumulated = accumulativeDividendOf(account);
        uint256 withdrawn = withdrawnDividends[account];
        return accumulated > withdrawn ? accumulated - withdrawn : 0;
    }

    function accumulativeDividendOf(address account) public view returns (uint256) {
        if (excludedFromDividends[account]) {
            return 0;
        }

        uint256 balance = balanceOf(account);
        int256 magnified = _toInt256(magnifiedDividendPerShare * balance) + _magnifiedDividendCorrections[account];

        if (magnified <= 0) {
            return 0;
        }

        return uint256(magnified) / MAGNITUDE;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from == address(0) || to == address(0) || value == 0) {
            _rawUpdate(from, to, value);
            return;
        }

        bool isBuy = automatedMarketMakerPairs[from];
        bool isSell = automatedMarketMakerPairs[to];

        if (!tradingEnabled) {
            require(isFeeExempt[from] || isFeeExempt[to], "RuyiToken: trading disabled");
        }

        if (!isTxLimitExempt[from] && !isTxLimitExempt[to]) {
            require(value <= maxTxAmount, "RuyiToken: max tx");
            if (!isSell) {
                require(balanceOf(to) + value <= maxWalletAmount, "RuyiToken: max wallet");
            }
        }

        bool takeFee = (isBuy || isSell) && !isFeeExempt[from] && !isFeeExempt[to];
        if (!takeFee) {
            _rawUpdate(from, to, value);
            return;
        }

        FeeRates memory rates = isSell ? sellFees : buyFees;

        uint256 totalFeeBps_ = _totalFeeBps(rates);
        if (totalFeeBps_ == 0) {
            _rawUpdate(from, to, value);
            return;
        }

        uint256 feeAmount = (value * totalFeeBps_) / BPS;
        if (feeAmount == 0) {
            _rawUpdate(from, to, value);
            return;
        }

        uint256 platformAmount = (feeAmount * PLATFORM_TAX_SHARE_BPS) / BPS;
        uint256 projectFeeAmount = feeAmount - platformAmount;

        uint256 evolutionAmount = _projectFeeShare(projectFeeAmount, rates.evolution, totalFeeBps_);
        uint256 fortuneAmount = _projectFeeShare(projectFeeAmount, rates.fortune, totalFeeBps_);
        uint256 riskAmount = _projectFeeShare(projectFeeAmount, rates.risk, totalFeeBps_);
        uint256 rewardAmount = _projectFeeShare(projectFeeAmount, rates.reward, totalFeeBps_);
        uint256 treasuryAmount = _projectFeeShare(projectFeeAmount, rates.treasury, totalFeeBps_) + platformAmount;
        uint256 burnAmount = _projectFeeShare(projectFeeAmount, rates.burn, totalFeeBps_);

        uint256 routedAmount = evolutionAmount + fortuneAmount + riskAmount + rewardAmount + treasuryAmount + burnAmount;
        if (feeAmount > routedAmount) {
            treasuryAmount += feeAmount - routedAmount;
        }

        uint256 vaultAmount = evolutionAmount + fortuneAmount + riskAmount + rewardAmount + treasuryAmount;
        uint256 sendAmount = value - feeAmount;

        if (vaultAmount > 0) {
            _rawUpdate(from, vault, vaultAmount);
        }

        if (burnAmount > 0) {
            _rawUpdate(from, address(0), burnAmount);
        }

        _rawUpdate(from, to, sendAmount);

        aura += evolutionAmount;

        IRuyiBeastVault(vault).recordFees(
            address(this),
            evolutionAmount,
            fortuneAmount,
            riskAmount,
            rewardAmount,
            treasuryAmount,
            burnAmount
        );

        if (isSell) {
            try IRuyiBeastVault(vault).processAutoDex(address(this)) {}
            catch {}
        }

        emit FeesTaken(from, to, isSell, feeAmount, evolutionAmount, rewardAmount);
    }

    function _rawUpdate(address from, address to, uint256 value) private {
        super._update(from, to, value);
        _moveDividendShares(from, to, value);
    }

    function _moveDividendShares(address from, address to, uint256 value) private {
        if (value == 0) {
            return;
        }

        uint256 magnifiedValue = magnifiedDividendPerShare * value;

        if (from != address(0) && !excludedFromDividends[from]) {
            _dividendSupply -= value;
            _magnifiedDividendCorrections[from] += _toInt256(magnifiedValue);
        }

        if (to != address(0) && !excludedFromDividends[to]) {
            _dividendSupply += value;
            _magnifiedDividendCorrections[to] -= _toInt256(magnifiedValue);
        }
    }

    function _setFeeExempt(address account, bool exempt) private {
        require(account != address(0), "RuyiToken: zero account");
        isFeeExempt[account] = exempt;
        emit FeeExemptUpdated(account, exempt);
    }

    function _setTxLimitExempt(address account, bool exempt) private {
        require(account != address(0), "RuyiToken: zero account");
        isTxLimitExempt[account] = exempt;
        emit TxLimitExemptUpdated(account, exempt);
    }

    function _setExcludedFromDividends(address account, bool excluded) private {
        require(account != address(0), "RuyiToken: zero account");

        if (excludedFromDividends[account] == excluded) {
            return;
        }

        uint256 balance = balanceOf(account);
        uint256 magnifiedBalance = magnifiedDividendPerShare * balance;

        excludedFromDividends[account] = excluded;

        if (excluded) {
            _dividendSupply -= balance;
            _magnifiedDividendCorrections[account] += _toInt256(magnifiedBalance);
        } else {
            _dividendSupply += balance;
            _magnifiedDividendCorrections[account] -= _toInt256(magnifiedBalance);
        }

        emit ExcludedFromDividends(account, excluded);
    }

    function _lockControls() private {
        if (controlsLocked) {
            return;
        }

        controlsLocked = true;
        emit ControlsLocked();
    }

    function _totalFeeBps(FeeRates memory fees) private pure returns (uint256) {
        return fees.evolution + fees.fortune + fees.risk + fees.reward + fees.treasury + fees.burn;
    }

    function _projectFeeShare(
        uint256 projectFeeAmount,
        uint16 feeBps,
        uint256 totalFeeBps_
    ) private pure returns (uint256) {
        if (feeBps == 0 || projectFeeAmount == 0) {
            return 0;
        }

        return (projectFeeAmount * feeBps) / totalFeeBps_;
    }

    function _toInt256(uint256 value) private pure returns (int256) {
        require(value <= uint256(type(int256).max), "RuyiToken: int overflow");
        return int256(value);
    }
}
