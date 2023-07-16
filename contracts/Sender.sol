// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract Sender is AccessControlUpgradeable, UUPSUpgradeable {
    bytes32 public constant FEE_MANAGER_ROLE = keccak256("FEE_MANAGER_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

    IERC20 public feeToken; 
    uint256 public fees;
    address public feeReceiver;
    bool public isPaused;

    struct Message {
        address sender;
        address contractAddress;
        bytes data;
        uint256 value;
        uint256 chainId;
    }

    mapping(bytes32 => Message) public messages; // nonce -> message

    event NewFees(address indexed feeToken, uint256 indexed fees, address indexed feeManager);
    event NewPauseStatus(bool isPaused);
    event NewFeeReceiver(address indexed oldFeeReceiver, address indexed newFeeReceiver);
    event RequestForSignature(address indexed sender, address indexed contractAddress, bytes data, uint256 value, bytes32 indexed nonce, uint256 chainId);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    modifier whenNotPaused() {
        require(!isPaused, "Sender: Service is paused");
        _;
    }

    function _authorizeUpgrade(address newImplementation) internal virtual override {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Caller has no admin role");
    }

    function initialize() public initializer() {
        __AccessControl_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(UPGRADER_ROLE, msg.sender);
        _grantRole(FEE_MANAGER_ROLE, msg.sender);

        isPaused = false;
        fees = 0;
    }

    function setFees(address _feeTokenAddress, uint256 _fees) public {
        require(hasRole(FEE_MANAGER_ROLE, msg.sender), "Caller has no fee manager role");
        
        if (_feeTokenAddress == address(0)) {
            require(_fees == 0, "Invalid fee token address");
        } else {
            require(_fees > 0, "fees must be greater than 0");
        }

        feeToken = IERC20(_feeTokenAddress);
        fees = _fees;

        emit NewFees(_feeTokenAddress, fees, msg.sender);
    }

    function setFeeReceiver(address _feeReceiver) public {
        require(hasRole(FEE_MANAGER_ROLE, msg.sender), "Caller has no fee manager role");
        require(_feeReceiver != address(0), "Invalid fee receiver address");

        address oldFeeReceiver = feeReceiver;
        feeReceiver = _feeReceiver;

        emit NewFeeReceiver(oldFeeReceiver, feeReceiver);
    }

    function setPause(bool _pause) public {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Caller has no admin role");

        isPaused = _pause;
        emit NewPauseStatus(_pause);
    }

    function sendMessage(address _contractAddress, bytes calldata _data, uint256 _chainId) public payable whenNotPaused() {
        require(_contractAddress != address(0), "Invalid foreign contract address");

        if (address(feeToken) != address(0)) {
            require(feeToken.allowance(tx.origin, address(this)) >= fees, "The sender does not have approval to spend the user's tokens");
            
            feeToken.transferFrom(tx.origin, feeReceiver, fees); // msg.sender can be a smart contract - we need original sender
        }

        bytes32 nonce = keccak256(abi.encodePacked(_contractAddress, _data, _chainId));
        require(messages[nonce].sender == address(0) || messages[nonce].contractAddress == address(0), "Message already used");

        messages[nonce] = Message( {sender: tx.origin, contractAddress: _contractAddress, data: _data, value: msg.value, chainId: _chainId} );
        emit RequestForSignature(tx.origin, _contractAddress, _data, msg.value, nonce, _chainId);
    }
}