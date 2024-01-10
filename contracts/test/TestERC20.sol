// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestERC20 is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        _mint(msg.sender, 5000000000 * 10 ** decimals());
    }

    function mint(address _to, uint256 _amount) public {
        _mint(_to, _amount);
    }

    function mintPayable(address _to, uint256 _amount) public payable {
        _mint(_to, _amount);
    }
}