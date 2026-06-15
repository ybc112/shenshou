// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {RuyiBeastToken} from "./RuyiBeastToken.sol";
import {RuyiBeastVault} from "./RuyiBeastVault.sol";

contract RuyiBeastLaunchpad is Ownable, ReentrancyGuard {
    uint256 public constant DEFAULT_SUPPLY = 1_000_000_000 ether;

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
    address public platformTreasury;
    uint256 public creationFee;

    BeastProject[] private _projects;
    mapping(address => bool) public isLaunchpadToken;
    mapping(address => uint256) public tokenToProjectId;
    mapping(address => uint256[]) private _creatorProjects;

    event BeastCreated(
        uint256 indexed projectId,
        address indexed token,
        address indexed creator,
        string beastName,
        string tokenName,
        string tokenSymbol,
        BeastType beastType
    );
    event CreationFeeUpdated(uint256 creationFee);
    event PlatformTreasuryUpdated(address indexed platformTreasury);
    event NativeWithdrawn(address indexed to, uint256 amount);

    constructor(address platformTreasury_, uint256 creationFee_) Ownable(msg.sender) {
        platformTreasury = platformTreasury_ == address(0) ? msg.sender : platformTreasury_;
        creationFee = creationFee_;
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

        RuyiBeastToken beastToken = new RuyiBeastToken(
            params.tokenName,
            params.tokenSymbol,
            initialSupply,
            msg.sender,
            address(vault),
            address(this),
            projectId,
            params.beastName,
            params.metadataURI,
            auraThreshold
        );

        token = address(beastToken);
        vault.registerToken(token);

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

    function setCreationFee(uint256 newCreationFee) external onlyOwner {
        creationFee = newCreationFee;
        emit CreationFeeUpdated(newCreationFee);
    }

    function setPlatformTreasury(address newPlatformTreasury) external onlyOwner {
        require(newPlatformTreasury != address(0), "RuyiLaunchpad: zero treasury");
        platformTreasury = newPlatformTreasury;
        emit PlatformTreasuryUpdated(newPlatformTreasury);
    }

    function setEvolutionPayoutConfig(
        address token,
        uint16 burnBps,
        uint16 rewardDividendBps
    ) external onlyOwner {
        require(isLaunchpadToken[token], "RuyiLaunchpad: unknown token");
        vault.setEvolutionPayoutConfig(token, burnBps, rewardDividendBps);
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
        require(to != address(0), "RuyiLaunchpad: zero recipient");
        require(address(this).balance >= amount, "RuyiLaunchpad: insufficient balance");

        (bool ok, ) = to.call{value: amount}("");
        require(ok, "RuyiLaunchpad: native transfer failed");

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

    function _forwardCreationFee() private {
        if (creationFee == 0) {
            return;
        }

        (bool ok, ) = payable(platformTreasury).call{value: creationFee}("");
        require(ok, "RuyiLaunchpad: fee transfer failed");

        uint256 refund = msg.value - creationFee;
        if (refund > 0) {
            (bool refunded, ) = payable(msg.sender).call{value: refund}("");
            require(refunded, "RuyiLaunchpad: refund failed");
        }
    }
}
