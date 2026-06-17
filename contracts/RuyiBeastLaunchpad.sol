// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {RuyiBeastVault} from "./RuyiBeastVault.sol";

interface IRuyiBeastTokenDeployer {
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
        uint256 auraThreshold,
        bytes32 salt
    ) external returns (address token);
}

interface IRuyiBeastSaleVaultDeployer {
    function deploySaleVault(
        address token,
        address creator,
        address liquidityReceiver,
        address liquidityRouter,
        uint256 mintCount,
        uint256 tokensPerMint,
        uint256 mintPrice,
        uint256 maxMintPerWallet,
        uint256 whitelistMintLimit,
        bool whitelistEnabled,
        uint256 saleDeadline,
        bool autoOpenTrading
    ) external returns (address saleVault);
}

interface IRuyiLaunchToken is IERC20 {
    struct FeeRates {
        uint16 evolution;
        uint16 fortune;
        uint16 risk;
        uint16 reward;
        uint16 treasury;
        uint16 burn;
    }

    function setFees(FeeRates calldata newBuyFees, FeeRates calldata newSellFees) external;
    function setFeeExempt(address account, bool exempt) external;
    function setTxLimitExempt(address account, bool exempt) external;
    function setExcludedFromDividends(address account, bool excluded) external;
    function setLaunchSaleVault(address saleVault) external;

    function transferOwnership(address newOwner) external;
}

contract RuyiBeastLaunchpad is Ownable, ReentrancyGuard {
    uint256 public constant DEFAULT_SUPPLY = 1_000_000_000 ether;
    uint16 public constant BPS = 10_000;
    uint16 public constant DEFAULT_REQUIRED_TOKEN_SUFFIX = 0xdddd;
    address public constant PANCAKE_V2_ROUTER_BSC = 0x10ED43C718714eb63d5aA57B78B54704E256024E;

    enum BeastType {
        Qilin,
        Phoenix,
        Pixiu,
        NineTailFox,
        AzureDragon,
        WhiteTiger,
        Turtle,
        Custom
    }

    struct CreateBeastParams {
        string beastName;
        string tokenName;
        string tokenSymbol;
        string metadataURI;
        uint256 initialSupply;
        uint256 auraThreshold;
        BeastType beastType;
        uint256 mintCount;
        uint256 tokensPerMint;
        uint256 mintPrice;
        uint256 maxMintPerWallet;
        uint256 whitelistMintLimit;
        bool whitelistEnabled;
        uint256 saleDeadline;
        address fundsReceiver;
        IRuyiLaunchToken.FeeRates buyFees;
        IRuyiLaunchToken.FeeRates sellFees;
        bool customFees;
        bool autoOpenTrading;
        bytes32 salt;
    }

    struct BeastProject {
        uint256 id;
        address token;
        address creator;
        string beastName;
        string tokenName;
        string tokenSymbol;
        string metadataURI;
        uint256 initialSupply;
        uint256 auraThreshold;
        BeastType beastType;
        uint256 createdAt;
    }

    RuyiBeastVault public immutable vault;
    address public immutable tokenDeployer;
    address public immutable saleVaultDeployer;
    address public platformTreasury;
    address public defaultMintLiquidityRouter;
    uint256 public creationFee;
    uint16 public requiredTokenSuffix;

    BeastProject[] private _projects;
    mapping(address => bool) public isLaunchpadToken;
    mapping(address => uint256) public tokenToProjectId;
    mapping(address => uint256[]) private _creatorProjects;
    mapping(uint256 => address) public projectSaleVault;
    mapping(address => bool) public dexOperators;

    event BeastCreated(
        uint256 indexed projectId,
        address indexed token,
        address indexed creator,
        string beastName,
        string tokenName,
        string tokenSymbol,
        BeastType beastType
    );
    event LaunchSaleCreated(
        uint256 indexed projectId,
        address indexed saleVault,
        uint256 mintCount,
        uint256 tokensPerMint,
        uint256 saleSupply,
        uint256 mintPrice,
        uint256 maxMintPerWallet,
        uint256 whitelistMintLimit,
        bool whitelistEnabled,
        uint256 saleDeadline,
        address indexed liquidityReceiver,
        address liquidityRouter
    );
    event CreationFeeUpdated(uint256 creationFee);
    event PlatformTreasuryUpdated(address indexed platformTreasury);
    event DefaultMintLiquidityRouterUpdated(address indexed router);
    event RequiredTokenSuffixUpdated(uint16 indexed suffix);
    event NativeWithdrawn(address indexed to, uint256 amount);
    event DexOperatorUpdated(address indexed operator, bool enabled);

    modifier onlyDexExecutor() {
        require(msg.sender == owner() || dexOperators[msg.sender], "RuyiLaunchpad: not dex executor");
        _;
    }

    constructor(
        address platformTreasury_,
        uint256 creationFee_,
        address tokenDeployer_,
        address saleVaultDeployer_
    ) Ownable(msg.sender) {
        require(tokenDeployer_ != address(0), "RuyiLaunchpad: zero token deployer");
        require(saleVaultDeployer_ != address(0), "RuyiLaunchpad: zero sale deployer");

        platformTreasury = platformTreasury_ == address(0) ? msg.sender : platformTreasury_;
        creationFee = creationFee_;
        tokenDeployer = tokenDeployer_;
        saleVaultDeployer = saleVaultDeployer_;
        requiredTokenSuffix = DEFAULT_REQUIRED_TOKEN_SUFFIX;
        if (block.chainid == 56) {
            defaultMintLiquidityRouter = PANCAKE_V2_ROUTER_BSC;
        }
        vault = new RuyiBeastVault(address(this));
    }

    receive() external payable {}

    function createBeast(CreateBeastParams calldata params) external payable nonReentrant returns (address token) {
        require(bytes(params.beastName).length > 0, "RuyiLaunchpad: empty beast name");
        require(bytes(params.tokenName).length > 0, "RuyiLaunchpad: empty token name");
        require(bytes(params.tokenSymbol).length > 0, "RuyiLaunchpad: empty token symbol");
        require(msg.value >= creationFee, "RuyiLaunchpad: insufficient fee");

        uint256 projectId = _projects.length;
        uint256 initialSupply = params.initialSupply == 0 ? DEFAULT_SUPPLY : params.initialSupply;
        uint256 auraThreshold = params.auraThreshold == 0 ? initialSupply / 1_000 : params.auraThreshold;
        bool saleEnabled = params.mintCount > 0;
        uint256 mintVaultSupply = 0;

        if (saleEnabled) {
            require(params.tokensPerMint > 0, "RuyiLaunchpad: zero tokens per mint");
            require(params.mintPrice > 0, "RuyiLaunchpad: zero mint price");
            require(params.whitelistMintLimit <= params.mintCount, "RuyiLaunchpad: bad whitelist limit");
            if (params.maxMintPerWallet > 0) {
                require(params.maxMintPerWallet <= params.mintCount, "RuyiLaunchpad: bad wallet limit");
            }
            if (params.whitelistEnabled) {
                require(params.whitelistMintLimit > 0, "RuyiLaunchpad: zero whitelist limit");
            }
            if (params.saleDeadline > 0) {
                require(params.saleDeadline > block.timestamp, "RuyiLaunchpad: invalid deadline");
            }
            mintVaultSupply = _mintVaultSupply(params.mintCount, params.tokensPerMint);
            require(mintVaultSupply <= initialSupply, "RuyiLaunchpad: sale exceeds supply");
        } else {
            require(params.tokensPerMint == 0, "RuyiLaunchpad: sale supply required");
            require(params.mintPrice == 0, "RuyiLaunchpad: sale supply required");
            require(params.maxMintPerWallet == 0, "RuyiLaunchpad: sale supply required");
            require(params.whitelistMintLimit == 0, "RuyiLaunchpad: sale supply required");
            require(!params.whitelistEnabled, "RuyiLaunchpad: sale supply required");
            require(params.saleDeadline == 0, "RuyiLaunchpad: sale supply required");
            require(params.fundsReceiver == address(0), "RuyiLaunchpad: sale supply required");
        }

        bytes32 tokenSalt = keccak256(
            abi.encodePacked(msg.sender, params.salt, params.tokenName, params.tokenSymbol, block.chainid)
        );

        token = IRuyiBeastTokenDeployer(tokenDeployer).deployToken(
            params.tokenName,
            params.tokenSymbol,
            initialSupply,
            address(this),
            address(vault),
            address(this),
            projectId,
            params.beastName,
            params.metadataURI,
            auraThreshold,
            tokenSalt
        );
        _requireTokenSuffix(token);

        vault.registerToken(token);
        IRuyiLaunchToken beastToken = IRuyiLaunchToken(token);

        if (params.customFees) {
            beastToken.setFees(params.buyFees, params.sellFees);
        }

        if (saleEnabled) {
            address receiver = params.fundsReceiver;
            address mintRouter = defaultMintLiquidityRouter;
            address saleVault = IRuyiBeastSaleVaultDeployer(saleVaultDeployer).deploySaleVault(
                token,
                msg.sender,
                receiver,
                mintRouter,
                params.mintCount,
                params.tokensPerMint,
                params.mintPrice,
                params.maxMintPerWallet,
                params.whitelistMintLimit,
                params.whitelistEnabled,
                params.saleDeadline,
                params.autoOpenTrading
            );

            uint256 creatorSupply = initialSupply - mintVaultSupply;
            if (creatorSupply > 0) {
                require(beastToken.transfer(msg.sender, creatorSupply), "RuyiLaunchpad: creator transfer failed");
            }
            beastToken.setLaunchSaleVault(saleVault);
            beastToken.setFeeExempt(saleVault, true);
            beastToken.setTxLimitExempt(saleVault, true);
            beastToken.setExcludedFromDividends(saleVault, true);
            if (mintRouter != address(0)) {
                beastToken.setFeeExempt(mintRouter, true);
                beastToken.setTxLimitExempt(mintRouter, true);
                beastToken.setExcludedFromDividends(mintRouter, true);
            }
            require(beastToken.transfer(saleVault, mintVaultSupply), "RuyiLaunchpad: sale transfer failed");
            beastToken.transferOwnership(saleVault);

            projectSaleVault[projectId] = saleVault;

            emit LaunchSaleCreated(
                projectId,
                saleVault,
                params.mintCount,
                params.tokensPerMint,
                mintVaultSupply,
                params.mintPrice,
                params.maxMintPerWallet,
                params.whitelistMintLimit,
                params.whitelistEnabled,
                params.saleDeadline,
                receiver,
                mintRouter
            );
        } else {
            beastToken.setFeeExempt(msg.sender, true);
            beastToken.setTxLimitExempt(msg.sender, true);
            require(beastToken.transfer(msg.sender, initialSupply), "RuyiLaunchpad: creator transfer failed");
            beastToken.transferOwnership(msg.sender);
        }

        _projects.push(
            BeastProject({
                id: projectId,
                token: token,
                creator: msg.sender,
                beastName: params.beastName,
                tokenName: params.tokenName,
                tokenSymbol: params.tokenSymbol,
                metadataURI: params.metadataURI,
                initialSupply: initialSupply,
                auraThreshold: auraThreshold,
                beastType: params.beastType,
                createdAt: block.timestamp
            })
        );

        isLaunchpadToken[token] = true;
        tokenToProjectId[token] = projectId;
        _creatorProjects[msg.sender].push(projectId);

        _forwardCreationFee();

        emit BeastCreated(
            projectId,
            token,
            msg.sender,
            params.beastName,
            params.tokenName,
            params.tokenSymbol,
            params.beastType
        );
    }

    function _mintVaultSupply(uint256 mintCount, uint256 tokensPerMint) private pure returns (uint256) {
        uint256 userTokenSupply = mintCount * tokensPerMint;
        uint256 liquidityTokenSupply = (userTokenSupply * BPS) / BPS;
        return userTokenSupply + liquidityTokenSupply;
    }

    function setCreationFee(uint256 newCreationFee) external onlyOwner {
        creationFee = newCreationFee;
        emit CreationFeeUpdated(newCreationFee);
    }

    function setPlatformTreasury(address newPlatformTreasury) external onlyOwner {
        require(newPlatformTreasury != address(0), "RuyiLaunchpad: zero treasury");
        platformTreasury = newPlatformTreasury;
        emit PlatformTreasuryUpdated(newPlatformTreasury);
    }

    function setDefaultMintLiquidityRouter(address router) external onlyOwner {
        defaultMintLiquidityRouter = router;
        emit DefaultMintLiquidityRouterUpdated(router);
    }

    function setRequiredTokenSuffix(uint16 suffix) external onlyOwner {
        requiredTokenSuffix = suffix;
        emit RequiredTokenSuffixUpdated(suffix);
    }

    function setEvolutionPayoutConfig(
        address token,
        uint16 burnBps,
        uint16 rewardDividendBps
    ) external {
        _requireProjectOperator(token);
        vault.setEvolutionPayoutConfig(token, burnBps, rewardDividendBps);
    }

    function setRewardConfig(
        address token,
        uint16 talismanChanceBps,
        uint16 talismanPrizeBps,
        uint16 luckyPrizeBps,
        uint16 luckyModulo,
        uint256 minHoldAmount,
        bool enabled
    ) external {
        _requireProjectOperator(token);
        vault.setRewardConfig(
            token,
            talismanChanceBps,
            talismanPrizeBps,
            luckyPrizeBps,
            luckyModulo,
            minHoldAmount,
            enabled
        );
    }

    function openRewardRound(address token) external returns (uint256 round) {
        _requireProjectOperator(token);
        return vault.openRewardRound(token);
    }

    function assignLuckyNumber(address token) external nonReentrant returns (uint16 number) {
        require(isLaunchpadToken[token], "RuyiLaunchpad: unknown token");
        return vault.assignLuckyNumber(token, msg.sender);
    }

    function claimTalismanReward(
        address token
    ) external nonReentrant returns (bool won, uint256 amount, uint16 roll) {
        require(isLaunchpadToken[token], "RuyiLaunchpad: unknown token");
        return vault.claimTalismanReward(token, msg.sender);
    }

    function claimLuckyNumberReward(address token, uint256 round) external nonReentrant returns (uint256 amount) {
        require(isLaunchpadToken[token], "RuyiLaunchpad: unknown token");
        return vault.claimLuckyNumberReward(token, msg.sender, round);
    }

    function setDexOperator(address operator, bool enabled) external onlyOwner {
        require(operator != address(0), "RuyiLaunchpad: zero operator");
        dexOperators[operator] = enabled;
        emit DexOperatorUpdated(operator, enabled);
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
    ) external {
        _requireProjectOperator(token);
        vault.setDexConfig(
            token,
            router,
            pairedToken,
            pair,
            liquidityReceiver,
            buybackRecipient,
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
    ) external {
        _requireProjectOperator(token);
        vault.setDexAutomationConfig(token, autoBuybackBps, autoLiquidityBps, autoProcessThreshold, autoProcessLimit);
    }

    function processAutoDex(
        address token
    ) external returns (uint256 processedAmount, uint256 buybackOut, uint256 liquidity) {
        _requireProjectOperatorOrDexExecutor(token);
        return vault.processAutoDex(token);
    }

    function executeNativeBuyback(
        address token,
        uint256 amountOutMin,
        uint256 deadline
    ) external payable nonReentrant onlyDexExecutor returns (uint256 amountOut) {
        require(isLaunchpadToken[token], "RuyiLaunchpad: unknown token");
        return vault.executeNativeBuyback{value: msg.value}(token, amountOutMin, deadline);
    }

    function executeTokenBuyback(
        address token,
        uint256 amountIn,
        uint256 amountOutMin,
        uint256 deadline
    ) external nonReentrant onlyDexExecutor returns (uint256 amountOut) {
        require(isLaunchpadToken[token], "RuyiLaunchpad: unknown token");
        return vault.executeTokenBuyback(token, amountIn, amountOutMin, deadline);
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
        nonReentrant
        onlyDexExecutor
        returns (uint256 amountToken, uint256 amountNative, uint256 liquidity)
    {
        require(isLaunchpadToken[token], "RuyiLaunchpad: unknown token");
        return vault.executeAddLiquidityNative{value: msg.value}(
            token,
            tokenAmount,
            amountTokenMin,
            amountNativeMin,
            deadline
        );
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
        nonReentrant
        onlyDexExecutor
        returns (uint256 amountToken, uint256 amountPaired, uint256 liquidity)
    {
        require(isLaunchpadToken[token], "RuyiLaunchpad: unknown token");
        return vault.executeAddLiquidityToken(
            token,
            tokenAmount,
            pairedAmount,
            amountTokenMin,
            amountPairedMin,
            deadline
        );
    }

    function withdrawVaultNative(address payable to, uint256 amount) external onlyOwner {
        vault.withdrawNative(to, amount);
    }

    function withdrawVaultExternalToken(address token, address to, uint256 amount) external onlyOwner {
        vault.withdrawExternalToken(token, to, amount);
    }

    function withdrawTreasuryPool(address token, address to, uint256 amount) external onlyOwner {
        require(isLaunchpadToken[token], "RuyiLaunchpad: unknown token");
        vault.withdrawTreasuryPool(token, to, amount);
    }

    function withdrawOperationalPool(address token, address to, uint8 poolType, uint256 amount) external onlyOwner {
        require(isLaunchpadToken[token], "RuyiLaunchpad: unknown token");
        vault.withdrawOperationalPool(token, to, poolType, amount);
    }

    function withdrawNative(address payable to, uint256 amount) external onlyOwner nonReentrant {
        require(address(this).balance >= amount, "RuyiLaunchpad: insufficient balance");
        _sendNative(to, amount, "RuyiLaunchpad: native transfer failed");
        emit NativeWithdrawn(to, amount);
    }

    function projectCount() external view returns (uint256) {
        return _projects.length;
    }

    function getProject(uint256 projectId) external view returns (BeastProject memory) {
        require(projectId < _projects.length, "RuyiLaunchpad: invalid project");
        return _projects[projectId];
    }

    function getProjects(uint256 offset, uint256 limit) external view returns (BeastProject[] memory projects) {
        uint256 total = _projects.length;
        if (offset >= total || limit == 0) {
            return projects;
        }

        uint256 end = offset + limit;
        if (end > total) {
            end = total;
        }

        projects = new BeastProject[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            projects[i - offset] = _projects[i];
        }
    }

    function getCreatorProjects(address creator) external view returns (uint256[] memory) {
        return _creatorProjects[creator];
    }

    function isProjectOperator(address token, address account) public view returns (bool) {
        if (!isLaunchpadToken[token] || account == address(0)) {
            return false;
        }

        BeastProject storage project = _projects[tokenToProjectId[token]];
        return account == owner() || account == project.creator;
    }

    function _requireProjectOperator(address token) private view {
        require(isLaunchpadToken[token], "RuyiLaunchpad: unknown token");
        require(isProjectOperator(token, msg.sender), "RuyiLaunchpad: not project operator");
    }

    function _requireProjectOperatorOrDexExecutor(address token) private view {
        require(isLaunchpadToken[token], "RuyiLaunchpad: unknown token");
        require(
            isProjectOperator(token, msg.sender) || dexOperators[msg.sender],
            "RuyiLaunchpad: not project operator"
        );
    }

    function _forwardCreationFee() private {
        uint256 refund = msg.value;
        if (creationFee > 0) {
            _sendNative(payable(platformTreasury), creationFee, "RuyiLaunchpad: fee transfer failed");
            refund -= creationFee;
        }

        _sendNative(payable(msg.sender), refund, "RuyiLaunchpad: refund failed");
    }

    function _requireTokenSuffix(address token) private view {
        uint16 suffix = requiredTokenSuffix;
        if (suffix == 0) {
            return;
        }
        require(uint16(uint160(token)) == suffix, "RuyiLaunchpad: bad token suffix");
    }

    function _sendNative(address payable to, uint256 amount, string memory errorMessage) private {
        if (amount == 0) {
            return;
        }

        require(to != address(0), "RuyiLaunchpad: zero recipient");
        (bool ok, ) = to.call{value: amount}("");
        require(ok, errorMessage);
    }
}
