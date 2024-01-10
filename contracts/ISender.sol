// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

interface ISender {
    function sendMessage(address _targetAddress, bytes calldata _data, uint256 _value, uint256 _chainId) external;
}