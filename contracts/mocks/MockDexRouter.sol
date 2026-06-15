// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockDexRouter {
    address public immutable WETH;
    uint256 public liquidityNonce;

    constructor(address weth_) {
        WETH = weth_;
    }

    receive() external payable {}

    function swapExactETHForTokensSupportingFeeOnTransferTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256
    ) external payable {
        require(path.length >= 2, "MockRouter: bad path");
        require(msg.value > 0, "MockRouter: zero native");

        address tokenOut = path[path.length - 1];
        uint256 amountOut = amountOutMin == 0 ? msg.value : amountOutMin;
        require(IERC20(tokenOut).transfer(to, amountOut), "MockRouter: transfer failed");
    }

    function swapExactTokensForETHSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256
    ) external {
        require(path.length >= 2, "MockRouter: bad path");
        require(IERC20(path[0]).transferFrom(msg.sender, address(this), amountIn), "MockRouter: input failed");

        uint256 amountOut = amountOutMin == 0 ? amountIn : amountOutMin;
        (bool ok, ) = payable(to).call{value: amountOut}("");
        require(ok, "MockRouter: native output failed");
    }

    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256
    ) external {
        require(path.length >= 2, "MockRouter: bad path");
        require(IERC20(path[0]).transferFrom(msg.sender, address(this), amountIn), "MockRouter: input failed");
        uint256 amountOut = amountOutMin == 0 ? amountIn : amountOutMin;
        require(IERC20(path[path.length - 1]).transfer(to, amountOut), "MockRouter: output failed");
    }

    function addLiquidityETH(
        address token,
        uint256 amountTokenDesired,
        uint256,
        uint256,
        address,
        uint256
    ) external payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity) {
        require(msg.value > 0, "MockRouter: zero native");
        require(IERC20(token).transferFrom(msg.sender, address(this), amountTokenDesired), "MockRouter: token failed");

        amountToken = amountTokenDesired;
        amountETH = msg.value;
        liquidity = ++liquidityNonce;
    }

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256,
        uint256,
        address,
        uint256
    ) external returns (uint256 amountA, uint256 amountB, uint256 liquidity) {
        require(IERC20(tokenA).transferFrom(msg.sender, address(this), amountADesired), "MockRouter: tokenA failed");
        require(IERC20(tokenB).transferFrom(msg.sender, address(this), amountBDesired), "MockRouter: tokenB failed");

        amountA = amountADesired;
        amountB = amountBDesired;
        liquidity = ++liquidityNonce;
    }
}
