// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {RuyiBeastToken} from "./RuyiBeastToken.sol";

contract RuyiBeastSaleVault is ReentrancyGuard {
    uint256 public constant TOKEN_UNIT = 1 ether;

    RuyiBeastToken public immutable token;
    address public immutable creator;
    address public immutable fundsReceiver;

    uint256 public immutable saleSupply;
    uint256 public remainingSaleSupply;
    uint256 public immutable mintPrice;
    uint256 public immutable maxMintPerWallet;
    uint256 public immutable saleDeadline;
    uint256 public nativeRaised;

    bool public finalized;
    bool public cancelled;

    mapping(address => uint256) public purchased;

    event BeastPurchased(address indexed buyer, uint256 tokenAmount, uint256 nativePaid);
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
        address fundsReceiver_,
        uint256 saleSupply_,
        uint256 mintPrice_,
        uint256 maxMintPerWallet_,
        uint256 saleDeadline_
    ) {
        require(token_ != address(0), "RuyiSale: zero token");
        require(creator_ != address(0), "RuyiSale: zero creator");
        require(fundsReceiver_ != address(0), "RuyiSale: zero receiver");
        require(saleSupply_ > 0, "RuyiSale: zero sale supply");
        require(mintPrice_ > 0, "RuyiSale: zero mint price");
        if (saleDeadline_ > 0) {
            require(saleDeadline_ > block.timestamp, "RuyiSale: invalid deadline");
        }

        token = RuyiBeastToken(token_);
        creator = creator_;
        fundsReceiver = fundsReceiver_;
        saleSupply = saleSupply_;
        remainingSaleSupply = saleSupply_;
        mintPrice = mintPrice_;
        maxMintPerWallet = maxMintPerWallet_;
        saleDeadline = saleDeadline_;
    }

    function buy(uint256 tokenAmount) external payable nonReentrant {
        require(tokenAmount > 0, "RuyiSale: zero amount");
        require(!finalized, "RuyiSale: finalized");
        require(!cancelled, "RuyiSale: cancelled");
        if (saleDeadline > 0) {
            require(block.timestamp <= saleDeadline, "RuyiSale: ended");
        }
        require(remainingSaleSupply >= tokenAmount, "RuyiSale: insufficient supply");

        uint256 nextPurchased = purchased[msg.sender] + tokenAmount;
        if (maxMintPerWallet > 0) {
            require(nextPurchased <= maxMintPerWallet, "RuyiSale: wallet limit");
        }

        uint256 cost = (tokenAmount * mintPrice) / TOKEN_UNIT;
        require(cost > 0, "RuyiSale: zero cost");
        require(msg.value >= cost, "RuyiSale: insufficient payment");

        purchased[msg.sender] = nextPurchased;
        remainingSaleSupply -= tokenAmount;
        nativeRaised += cost;

        require(IERC20(address(token)).transfer(msg.sender, tokenAmount), "RuyiSale: token transfer failed");
        _sendNative(payable(msg.sender), msg.value - cost, "RuyiSale: refund failed");

        emit BeastPurchased(msg.sender, tokenAmount, cost);
    }

    function finalize(address pair) external nonReentrant onlyCreator {
        require(pair != address(0), "RuyiSale: zero pair");
        require(!finalized, "RuyiSale: finalized");
        require(!cancelled, "RuyiSale: cancelled");
        require(
            remainingSaleSupply == 0 || (saleDeadline > 0 && block.timestamp > saleDeadline),
            "RuyiSale: active"
        );

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

        _sendNative(payable(fundsReceiver), proceeds, "RuyiSale: proceeds transfer failed");

        emit LaunchFinalized(pair, proceeds, unsoldTokens);
    }

    function cancel() external onlyCreator {
        require(!finalized, "RuyiSale: finalized");
        require(!cancelled, "RuyiSale: cancelled");
        require(saleDeadline > 0 && block.timestamp > saleDeadline, "RuyiSale: active");
        require(remainingSaleSupply > 0, "RuyiSale: sold out");

        cancelled = true;
        emit LaunchCancelled();
    }

    function claimRefund() external nonReentrant {
        require(cancelled, "RuyiSale: not cancelled");

        uint256 tokenAmount = purchased[msg.sender];
        require(tokenAmount > 0, "RuyiSale: no purchase");

        uint256 refundAmount = (tokenAmount * mintPrice) / TOKEN_UNIT;
        purchased[msg.sender] = 0;
        nativeRaised -= refundAmount;
        remainingSaleSupply += tokenAmount;

        require(IERC20(address(token)).transferFrom(msg.sender, address(this), tokenAmount), "RuyiSale: return failed");
        _sendNative(payable(msg.sender), refundAmount, "RuyiSale: refund failed");

        emit LaunchRefunded(msg.sender, tokenAmount, refundAmount);
    }

    function withdrawCancelledTokens(address to) external onlyCreator {
        require(cancelled, "RuyiSale: not cancelled");
        require(nativeRaised == 0, "RuyiSale: refunds pending");
        require(to != address(0), "RuyiSale: zero recipient");

        uint256 amount = remainingSaleSupply;
        remainingSaleSupply = 0;
        if (amount > 0) {
            require(IERC20(address(token)).transfer(to, amount), "RuyiSale: token transfer failed");
        }
        token.transferOwnership(creator);

        emit CancelledTokensWithdrawn(to, amount);
    }

    function _sendNative(address payable to, uint256 amount, string memory errorMessage) private {
        if (amount == 0) {
            return;
        }

        (bool ok, ) = to.call{value: amount}("");
        require(ok, errorMessage);
    }
}
