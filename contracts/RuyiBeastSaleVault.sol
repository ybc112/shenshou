// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {RuyiBeastToken} from "./RuyiBeastToken.sol";

interface IRuyiMintDexRouter {
    function addLiquidityETH(
        address token,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    ) external payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity);
}

contract RuyiBeastSaleVault is ReentrancyGuard {
    uint256 public constant TOKEN_UNIT = 1 ether;
    uint16 public constant BPS = 10_000;
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    RuyiBeastToken public immutable token;
    address public immutable creator;
    address public liquidityRouter;
    address public liquidityReceiver;
    uint16 public liquidityTokenBps;
    bool public mintLiquidityEnabled;

    uint256 public immutable saleSupply;
    uint256 public remainingSaleSupply;
    uint256 public immutable mintPrice;
    uint256 public immutable maxMintPerWallet;
    uint256 public immutable whitelistMintLimit;
    uint256 public immutable saleDeadline;
    uint256 public nativeRaised;
    uint256 public whitelistMinted;
    uint256 public publicMinted;
    uint256 public whitelistAccountCount;

    bool public finalized;
    bool public cancelled;
    bool public whitelistEnabled;

    mapping(address => uint256) public purchased;
    mapping(address => bool) public whitelistList;
    mapping(address => uint256) public whitelistMintedByWallet;

    event BeastMinted(
        address indexed buyer,
        uint256 tokenAmount,
        uint256 liquidityTokenAmount,
        uint256 nativePaid,
        uint256 liquidity
    );
    event MintLiquidityConfigUpdated(
        address indexed router,
        address indexed liquidityReceiver,
        uint16 liquidityTokenBps,
        bool enabled
    );
    event WhitelistEnabledUpdated(bool enabled);
    event WhitelistAccountUpdated(address indexed account, bool listed);
    event LaunchFinalized(address indexed pair, uint256 nativeRaised, uint256 unsoldTokens);
    event LaunchCancelled();
    event LaunchRefunded(address indexed buyer, uint256 tokenAmount, uint256 nativeAmount);
    event CancelledTokensWithdrawn(address indexed to, uint256 amount);

    modifier onlyCreator() {
        require(msg.sender == creator, "RuyiSale: only creator");
        _;
    }

    constructor(
        address token_,
        address creator_,
        address liquidityReceiver_,
        address liquidityRouter_,
        uint256 saleSupply_,
        uint256 mintPrice_,
        uint256 maxMintPerWallet_,
        uint256 whitelistMintLimit_,
        bool whitelistEnabled_,
        uint256 saleDeadline_
    ) {
        require(token_ != address(0), "RuyiSale: zero token");
        require(creator_ != address(0), "RuyiSale: zero creator");
        require(saleSupply_ > 0, "RuyiSale: zero sale supply");
        require(mintPrice_ > 0, "RuyiSale: zero mint price");
        require(whitelistMintLimit_ <= saleSupply_, "RuyiSale: bad whitelist limit");
        if (whitelistEnabled_) {
            require(whitelistMintLimit_ > 0, "RuyiSale: zero whitelist limit");
        }
        if (saleDeadline_ > 0) {
            require(saleDeadline_ > block.timestamp, "RuyiSale: invalid deadline");
        }

        token = RuyiBeastToken(token_);
        creator = creator_;
        liquidityReceiver = liquidityReceiver_ == address(0) ? DEAD : liquidityReceiver_;
        liquidityRouter = liquidityRouter_;
        liquidityTokenBps = BPS;
        mintLiquidityEnabled = liquidityRouter_ != address(0);
        saleSupply = saleSupply_;
        remainingSaleSupply = saleSupply_;
        mintPrice = mintPrice_;
        maxMintPerWallet = maxMintPerWallet_;
        whitelistMintLimit = whitelistMintLimit_;
        whitelistEnabled = whitelistEnabled_;
        saleDeadline = saleDeadline_;
    }

    function configureMintLiquidity(
        address router,
        uint16 liquidityTokenBps_,
        address liquidityReceiver_,
        bool enabled
    ) external onlyCreator {
        require(liquidityTokenBps_ <= BPS, "RuyiSale: bad liquidity bps");
        if (enabled) {
            require(router != address(0), "RuyiSale: zero router");
            require(liquidityTokenBps_ > 0, "RuyiSale: zero liquidity bps");
        }

        liquidityRouter = router;
        liquidityTokenBps = liquidityTokenBps_;
        liquidityReceiver = liquidityReceiver_ == address(0) ? DEAD : liquidityReceiver_;
        mintLiquidityEnabled = enabled;

        if (router != address(0)) {
            token.setFeeExempt(router, true);
            token.setTxLimitExempt(router, true);
            token.setExcludedFromDividends(router, true);
        }

        emit MintLiquidityConfigUpdated(router, liquidityReceiver, liquidityTokenBps_, enabled);
    }

    function setWhitelistEnabled(bool enabled) external onlyCreator {
        if (enabled) {
            require(whitelistMintLimit > 0, "RuyiSale: zero whitelist limit");
        }
        whitelistEnabled = enabled;
        emit WhitelistEnabledUpdated(enabled);
    }

    function setWhitelistAccount(address account, bool listed) external onlyCreator {
        require(account != address(0), "RuyiSale: zero account");
        _setWhitelistAccount(account, listed);
    }

    function setWhitelistAccounts(address[] calldata accounts, bool listed) external onlyCreator {
        for (uint256 i = 0; i < accounts.length; i++) {
            require(accounts[i] != address(0), "RuyiSale: zero account");
            _setWhitelistAccount(accounts[i], listed);
        }
    }

    function whitelistRemaining(address account) external view returns (uint256) {
        if (!whitelistEnabled || !whitelistList[account] || whitelistMinted >= whitelistMintLimit) {
            return 0;
        }
        return whitelistMintLimit - whitelistMinted;
    }

    function buy(uint256 tokenAmount) external payable nonReentrant {
        require(tokenAmount > 0, "RuyiSale: zero amount");
        require(!finalized, "RuyiSale: finalized");
        require(!cancelled, "RuyiSale: cancelled");
        require(mintLiquidityEnabled && liquidityRouter != address(0), "RuyiSale: mint liquidity disabled");
        if (saleDeadline > 0) {
            require(block.timestamp <= saleDeadline, "RuyiSale: ended");
        }

        uint256 nextPurchased = purchased[msg.sender] + tokenAmount;
        if (maxMintPerWallet > 0) {
            require(nextPurchased <= maxMintPerWallet, "RuyiSale: wallet limit");
        }
        _consumeMintQuota(msg.sender, tokenAmount);

        uint256 liquidityTokenAmount = (tokenAmount * liquidityTokenBps) / BPS;
        uint256 totalTokenAmount = tokenAmount + liquidityTokenAmount;
        require(remainingSaleSupply >= totalTokenAmount, "RuyiSale: insufficient supply");

        uint256 cost = (tokenAmount * mintPrice) / TOKEN_UNIT;
        require(cost > 0, "RuyiSale: zero cost");
        require(msg.value >= cost, "RuyiSale: insufficient payment");

        purchased[msg.sender] = nextPurchased;
        remainingSaleSupply -= totalTokenAmount;
        nativeRaised += cost;

        require(IERC20(address(token)).transfer(msg.sender, tokenAmount), "RuyiSale: token transfer failed");
        uint256 liquidity;
        _approve(address(token), liquidityRouter, liquidityTokenAmount);
        (, , liquidity) = IRuyiMintDexRouter(liquidityRouter).addLiquidityETH{value: cost}(
            address(token),
            liquidityTokenAmount,
            0,
            0,
            liquidityReceiver,
            block.timestamp
        );

        _sendNative(payable(msg.sender), msg.value - cost, "RuyiSale: refund failed");

        emit BeastMinted(msg.sender, tokenAmount, liquidityTokenAmount, cost, liquidity);
    }

    function _consumeMintQuota(address buyer, uint256 tokenAmount) private {
        uint256 remainingAmount = tokenAmount;
        bool whitelistPhaseActive = whitelistEnabled && whitelistMinted < whitelistMintLimit;

        if (whitelistPhaseActive) {
            require(whitelistList[buyer], "RuyiSale: not whitelisted");

            uint256 remainingWhitelist = whitelistMintLimit - whitelistMinted;
            uint256 whitelistAmount = remainingAmount < remainingWhitelist ? remainingAmount : remainingWhitelist;
            remainingAmount -= whitelistAmount;

            bool whitelistFilledAfterThisMint = whitelistMinted + whitelistAmount >= whitelistMintLimit;
            require(remainingAmount == 0 || whitelistFilledAfterThisMint, "RuyiSale: whitelist active");

            whitelistMinted += whitelistAmount;
            whitelistMintedByWallet[buyer] += whitelistAmount;
        }

        publicMinted += remainingAmount;
    }

    function _setWhitelistAccount(address account, bool listed) private {
        bool wasListed = whitelistList[account];
        if (wasListed == listed) {
            return;
        }

        whitelistList[account] = listed;
        if (listed) {
            whitelistAccountCount += 1;
        } else {
            whitelistAccountCount -= 1;
        }

        emit WhitelistAccountUpdated(account, listed);
    }

    function finalize(address pair) external nonReentrant {
        require(pair != address(0), "RuyiSale: zero pair");
        require(!finalized, "RuyiSale: finalized");
        require(!cancelled, "RuyiSale: cancelled");
        require(
            remainingSaleSupply == 0 || (saleDeadline > 0 && block.timestamp > saleDeadline),
            "RuyiSale: active"
        );

        // 如果时间还没到，只有创建者可以操作；时间到了后任何人都能触发开盘
        if (!(saleDeadline > 0 && block.timestamp > saleDeadline)) {
            require(msg.sender == creator, "RuyiSale: only creator");
        }

        uint256 unsoldTokens = remainingSaleSupply;
        uint256 proceeds = nativeRaised;
        finalized = true;
        remainingSaleSupply = 0;

        if (unsoldTokens > 0) {
            require(IERC20(address(token)).transfer(creator, unsoldTokens), "RuyiSale: unsold transfer failed");
        }

        token.setAutomatedMarketMakerPair(pair, true);
        token.enableTrading();
        token.transferOwnership(creator);

        emit LaunchFinalized(pair, proceeds, unsoldTokens);
    }

    function cancel() external onlyCreator {
        require(!finalized, "RuyiSale: finalized");
        require(!cancelled, "RuyiSale: cancelled");
        require(saleDeadline > 0 && block.timestamp > saleDeadline, "RuyiSale: active");
        require(nativeRaised == 0, "RuyiSale: mint already started");

        cancelled = true;
        emit LaunchCancelled();
    }

    function claimRefund() external nonReentrant {
        revert("RuyiSale: auto-liquidity mint has no refunds");
    }

    function withdrawCancelledTokens(address to) external onlyCreator {
        require(cancelled, "RuyiSale: not cancelled");
        require(to != address(0), "RuyiSale: zero recipient");

        uint256 amount = remainingSaleSupply;
        remainingSaleSupply = 0;
        if (amount > 0) {
            require(IERC20(address(token)).transfer(to, amount), "RuyiSale: token transfer failed");
        }
        token.transferOwnership(creator);

        emit CancelledTokensWithdrawn(to, amount);
    }

    function _approve(address token_, address spender, uint256 amount) private {
        require(IERC20(token_).approve(spender, 0), "RuyiSale: approve reset failed");
        require(IERC20(token_).approve(spender, amount), "RuyiSale: approve failed");
    }

    function _sendNative(address payable to, uint256 amount, string memory errorMessage) private {
        if (amount == 0) {
            return;
        }

        (bool ok, ) = to.call{value: amount}("");
        require(ok, errorMessage);
    }
}
