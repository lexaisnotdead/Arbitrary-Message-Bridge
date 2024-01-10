// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./ISender.sol";

contract Sender is AccessControlUpgradeable, UUPSUpgradeable, ISender {
    bytes32 public constant FEE_MANAGER_ROLE = keccak256("FEE_MANAGER_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

    IERC20 public feeToken; 
    uint256 public fees;
    address public feeReceiver;
    bool public isPaused;
    uint256 public nextMessageId; // rolling message id

    struct Message {
        address sender;
        address targetAddress;
        bytes data;
        uint256 value;
        uint256 homeChainId;
        uint256 foreignChainId;
    }

    mapping(uint256 => Message) public messages; // id -> message

    event NewFees(
        address indexed feeToken,
        uint256 indexed fees,
        address indexed feeManager
    );
    event NewPauseStatus(bool isPaused);
    event NewFeeReceiver(
        address indexed oldFeeReceiver,
        address indexed newFeeReceiver
    );
    event RequestForSignature(
        address indexed sender,
        address indexed targetAddress,
        bytes data,
        uint256 value,
        uint256 indexed id,
        uint256 homeChainId,
        uint256 foreignChainId,
        bytes32 hash
    );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    modifier whenNotPaused() {
        require(!isPaused, "Sender: Service is paused");
        _;
    }

    function _authorizeUpgrade(address) internal virtual override {
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
        nextMessageId = 0;
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

    function sendMessage(address _targetAddress, bytes calldata _data, uint256 _value, uint256 _chainId) public whenNotPaused() {
        require(_targetAddress != address(0), "Invalid foreign contract address");

        if (address(feeToken) != address(0)) {
            require(feeToken.allowance(msg.sender, address(this)) >= fees, "Sender contract does not have approval to spend the user's tokens");
            
            feeToken.transferFrom(msg.sender, feeReceiver, fees);
        }

        uint256 messageId = nextMessageId;
        ++nextMessageId; // increment nextMessageId for use on the next time
        require(messages[messageId].sender == address(0) || messages[messageId].targetAddress == address(0), "Message already used");

        uint256 homeChainId;
        assembly {
            homeChainId := chainid()
        }

        bytes32 messageHash = keccak256(abi.encodePacked(msg.sender, _targetAddress, _data, _value, messageId, homeChainId, _chainId));
        messages[messageId] = Message({
            sender: msg.sender,
            targetAddress: _targetAddress,
            data: _data,
            value: _value,
            foreignChainId: _chainId,
            homeChainId: homeChainId
        });

        emit RequestForSignature(msg.sender, _targetAddress, _data, _value, messageId, homeChainId, _chainId, messageHash);
    }
}