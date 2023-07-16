// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract TestERC721 is ERC721 {
    constructor() ERC721("Test NFT", "TNFT") {}

    function mint(address _to, uint256 _tokenId) public {
        _mint(_to, _tokenId);
    }

    function mintPayable(address _to, uint256 _tokenId) public payable {
        _mint(_to, _tokenId);
    }
}