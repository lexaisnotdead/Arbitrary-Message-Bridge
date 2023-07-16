// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@openzeppelin/contracts-upgradeable/access/AccessControlEnumerableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/ECDSAUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

contract Receiver is AccessControlEnumerableUpgradeable, UUPSUpgradeable, EIP712Upgradeable, ReentrancyGuardUpgradeable {
    bytes32 public constant VALIDATOR_ROLE = keccak256("VALIDATOR_ROLE");
    bytes32 public constant MESSAGE_TYPEHASH = keccak256("ValidateMessage(address sender,address contractAddress,bytes data,uint256 value,uint256 chainId,bytes32 nonce)");
   
    uint256 public requiredSignatures;
    bool public isPaused;

    struct Message {
        address sender;
        address contractAddress;
        bytes data;
        uint256 value;
        uint256 chainId;
        bytes32 nonce;
    }

    struct ValidatedMessage {
        address sender;
        address contractAddress;
        bytes data;
        uint256 value;
        uint256 chainId;
        address[] validators;
    }

    mapping (bytes32 => ValidatedMessage) public messages;
    mapping(bytes32 => bool) public executedMessages;

    event NewPauseStatus(bool isPaused);
    event ValidatorsRemoved(address[] validators);
    event MessageExecuted(address[] validators, address indexed sender, address contractAddress, bytes data, uint256 value, uint256 chainId, bytes32 indexed nonce);
    event MessageFailed(address indexed sender, address contractAddress, bytes data, uint256 value, uint256 chainId, bytes32 indexed nonce);
    event NewRequiredSignatures(uint256 indexed oldRequiredSignatures, uint256 indexed newRequiredSignatures);
    
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address[] calldata _validators, uint256 _requiredSignatures) public initializer() {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __EIP712_init("Receiver contract", "0.0.1");
        __ReentrancyGuard_init();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);

        require(_requiredSignatures == ( (_validators.length * 2) / 3 ), "The number of required signatures must be 2/3 of the number of validators");
        requiredSignatures = _requiredSignatures;

        for (uint256 i = 0; i < _validators.length; ++i) {
            _grantRole(VALIDATOR_ROLE, _validators[i]);
        }
    }

    receive() external payable {}

    modifier whenNotPaused() {
        require(!isPaused, "Receiver: Service is paused");
        _;
    }

    function getMessage(bytes32 _nonce) public view returns (ValidatedMessage memory) {
        return messages[_nonce];
    }

    function getExecutedMessage(bytes32 _nonce) public view returns (bool) {
        return executedMessages[_nonce];
    }

    function setPause(bool _pause) public {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Caller has no admin role");

        isPaused = _pause;
        emit NewPauseStatus(_pause);
    }

    function removeValidators(address[] calldata _validators) public {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Caller has no admin role");
        require((getRoleMemberCount(VALIDATOR_ROLE) - _validators.length) >= requiredSignatures, "Validators cannot be less than the number of required signatures");

        for (uint256 i = 0; i < _validators.length; ++i) {
            _revokeRole(VALIDATOR_ROLE, _validators[i]);
        }

        emit ValidatorsRemoved(_validators);
    }

    function setRequiredSignatures(uint256 _requiredSignatures) public {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Caller has no admin role");
        require(_requiredSignatures > 0, "The number of required signatures must be more than 0");

        uint256 oldRequiredSignatures = requiredSignatures;
        requiredSignatures = _requiredSignatures;

        emit NewRequiredSignatures(oldRequiredSignatures, requiredSignatures);
    }

    function _authorizeUpgrade(address newImplementation) internal virtual override {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Caller has no admin role");
    }

    function executeMessage(bytes[] calldata _validatorsSignatures, Message calldata message) public whenNotPaused() nonReentrant() returns (bool) {
        require(!executedMessages[message.nonce], "Message already executed");
        require(msg.sender == message.sender, "Only the original sender can execute the message. User addresses in different chains must be the same");

        uint256 validatorsNumber = 0;
        address[] memory validatorsArray = new address[](_validatorsSignatures.length);

        for (uint256 i = 0; i < _validatorsSignatures.length; ++i) {
            address validator = recoverSigner(message.sender, message.contractAddress, message.data, message.value, message.chainId, message.nonce, _validatorsSignatures[i]);

            if (!hasRole(VALIDATOR_ROLE, validator)) {
                continue;
            }

            if (arrayContains(validatorsArray, validator)) {
                continue;
            }

            validatorsArray[validatorsNumber] = validator;
            ++validatorsNumber;
        }

        require(validatorsNumber >= requiredSignatures, "Not enough signatures");
        address[] memory _validators = new address[](validatorsNumber); // we don't want ['0xf56c...', '0xhb5g...', '0x67tg...', '0x0000...', '0x0000...']
        for (uint256 i = 0; i < validatorsNumber; ++i) {
            _validators[i] = validatorsArray[i];
        }

        if (messages[message.nonce].sender == address(0) || // either this mapping is empty, or...
           (keccak256(abi.encodePacked(messages[message.nonce].validators)) != keccak256(abi.encodePacked(_validators))) ) { // ...the data stored in it is different (the user tries to reexecute the message after a failed attempt, but with different signatures)
            messages[message.nonce] = ValidatedMessage({
                sender:          message.sender,
                contractAddress: message.contractAddress,
                data:            message.data,
                value:           message.value,
                chainId:         message.chainId,
                validators:      _validators
            });
        }


        (bool success, ) = message.contractAddress.call{value: message.value}(message.data); // (target contract): if msg.sender == receiver contract -> tx.origin == original message sender (line #114)
        if (!success) {
            emit MessageFailed(message.sender, message.contractAddress, message.data, message.value, message.chainId, message.nonce);
            return false;
        }

        executedMessages[message.nonce] = true;
        emit MessageExecuted(_validators, message.sender, message.contractAddress, message.data, message.value, message.chainId, message.nonce);

        return true;
    }

    function arrayContains(address[] memory array, address value) private pure returns (bool) {
        for (uint256 i = 0; i < array.length; ++i) {
            if (array[i] == value) {
                return true;
            }
        }

        return false;
    }

    function recoverSigner(address _sender, address _contractAddress, bytes memory _data, uint256 value, uint256 _chainId, bytes32 _nonce, bytes memory _signature) private view returns(address) {
        bytes32 messageHash = keccak256(abi.encode(MESSAGE_TYPEHASH, _sender, _contractAddress, keccak256(abi.encodePacked(_data)), value, _chainId, _nonce));
        bytes32 digest = _hashTypedDataV4(messageHash);

        return ECDSAUpgradeable.recover(digest, _signature);
    }
}