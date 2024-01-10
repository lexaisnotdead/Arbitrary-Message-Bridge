// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@openzeppelin/contracts-upgradeable/access/AccessControlEnumerableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/ECDSAUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

contract Receiver is AccessControlEnumerableUpgradeable, UUPSUpgradeable, EIP712Upgradeable, ReentrancyGuardUpgradeable {
    bytes32 public constant VALIDATOR_ROLE = keccak256("VALIDATOR_ROLE");
    bytes32 public constant MESSAGE_TYPEHASH = keccak256("ValidateMessage(address sender,address targetAddress,bytes data,uint256 value,uint256 id,uint256 homeChainId,uint256 foreignChainId,bytes32 hash)");
    bool public isPaused;
    uint256 private validatorNumerator;
    uint256 private validatorDenominator;

    struct Message {
        address sender;
        address targetAddress;
        bytes data;
        uint256 value;
        uint256 id;
        uint256 homeChainId;
        uint256 foreignChainId;
        bytes32 hash;
    }

    struct ValidatedMessage {
        address sender;
        address targetAddress;
        bytes data;
        uint256 value;
        uint256 id;
        uint256 homeChainId;
        uint256 foreignChainId;
        address[] validators;
    }

    mapping (address => bool) public validators;
    mapping (uint256 => ValidatedMessage) public messages;
    mapping (uint256 => bool) public executedMessages;

    event NewPauseStatus(bool isPaused);
    event ValidatorAdded(address validator);
    event ValidatorRemoved(address validator);
    event MessageExecuted(
        address[] validators,
        address indexed sender,
        address indexed targetAddress,
        bytes data,
        uint256 value,
        uint256 indexed id,
        uint256 homeChainId,
        uint256 foreignChainId,
        bytes32 hash
    );
    event NewValidatorThresholdRatio(
        uint256 indexed newNumerator,
        uint256 indexed newDenominator
    );
    
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address[] calldata _validators, uint256 _validatorNumerator, uint256 _validatorDenominator) public initializer() {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __EIP712_init("Receiver contract", "0.0.1");
        __ReentrancyGuard_init();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);

        require(
            _validators.length * _validatorNumerator / _validatorDenominator >= 1,
            "bridge validator consensus threshold must be >= 1"
        );

        validatorNumerator = _validatorNumerator;
        validatorDenominator = _validatorDenominator;

        for (uint256 i = 0; i < _validators.length; ++i) {
            _grantRole(VALIDATOR_ROLE, _validators[i]);
        }
    }

    function _authorizeUpgrade(address ) internal virtual override {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Caller has no admin role");
    }

    receive() external payable {}

    modifier whenNotPaused() {
        require(!isPaused, "Receiver: Service is paused");
        _;
    }

    function getMessage(uint256 _messageId) public view returns (ValidatedMessage memory) {
        return messages[_messageId];
    }

    function getExecutedMessage(uint256 _messageId) public view returns (bool) {
        return executedMessages[_messageId];
    }

    function setPause(bool _pause) public {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Caller has no admin role");

        isPaused = _pause;
        emit NewPauseStatus(_pause);
    }

    function grantRole(bytes32 role, address account) public override(AccessControlUpgradeable, IAccessControlUpgradeable) {
        if (role == VALIDATOR_ROLE) {
            emit ValidatorAdded(account);
        }
        AccessControlUpgradeable.grantRole(role, account);
    }

    function revokeRole(bytes32 role, address account) public override(AccessControlUpgradeable, IAccessControlUpgradeable) {
        if (role == VALIDATOR_ROLE) {
            require(
                (getRoleMemberCount(VALIDATOR_ROLE) - 1) * validatorNumerator / validatorDenominator >= 1,
                "bridge validator consensus drops below 1"
            );
            emit ValidatorRemoved(account);
        }
        AccessControlUpgradeable.revokeRole(role, account);
    }

    function setValidatorRatio(uint256 _validatorNumerator, uint256 _validatorDenominator) public {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Caller has no admin role");
        require(
            getRoleMemberCount(VALIDATOR_ROLE) * _validatorNumerator / _validatorDenominator >= 1,
            "bridge validator consensus threshold must be >= 1"
        );
        
        validatorNumerator = _validatorNumerator;
        validatorDenominator = _validatorDenominator;

        emit NewValidatorThresholdRatio(validatorNumerator, validatorDenominator);
    }

    function executeMessage(bytes[] calldata _validatorsSignatures, Message calldata message) public payable whenNotPaused() nonReentrant() returns (bool) {
        require(!executedMessages[message.id], "Message already executed");
        // require(msg.sender == message.sender,?"Only the original sender can execute the message. User addresses in different chains must be the same");
        require(msg.value == message.value, "Receiver: funds do not satisfy the exact number for executing this message");
        
        uint256 chainId;
        assembly {
            chainId := chainid()
        }
        require(message.foreignChainId == chainId, "Wrong network");

        uint256 gatheredValidatorsNumber = 0;
        address[] memory gatheredValidators = new address[](_validatorsSignatures.length);
        
        for (uint256 i = 0; i < _validatorsSignatures.length; ++i) {
            address validator = recoverSigner(message, _validatorsSignatures[i]);

            if (!hasRole(VALIDATOR_ROLE, validator)) {
                continue;
            }

            if (validators[validator]) {
                continue;
            }

            validators[validator] = true;
            gatheredValidators[gatheredValidatorsNumber] = validator;
            ++gatheredValidatorsNumber;
        }

        require(
            gatheredValidatorsNumber >= getRoleMemberCount(VALIDATOR_ROLE)*validatorNumerator/validatorDenominator,
            "Not enough signatures"
        );

        if (gatheredValidatorsNumber < _validatorsSignatures.length) {
            assembly {
                mstore(gatheredValidators, gatheredValidatorsNumber)
            }
        }

        if (messages[message.id].sender == address(0) || // either this mapping is empty, or...
           (keccak256(abi.encodePacked(messages[message.id].validators)) != keccak256(abi.encodePacked(gatheredValidators)))) { // ...the data stored in it is different (the user tries to reexecute the message after a failed attempt, but with different signatures)
            messages[message.id] = ValidatedMessage({
                sender:          message.sender,
                targetAddress:   message.targetAddress,
                data:            message.data,
                value:           message.value,
                id:              message.id,
                homeChainId:     message.homeChainId,
                foreignChainId:  message.foreignChainId,
                validators:      gatheredValidators
            });
        }

        (bool success, ) = message.targetAddress.call{value: message.value}(message.data);
        if (!success) {
            revert("call to target address failed");
        }

        executedMessages[message.id] = true;
        emit MessageExecuted(
            gatheredValidators,
            message.sender,
            message.targetAddress,
            message.data,
            message.value,
            message.id,
            message.homeChainId,
            message.foreignChainId,
            message.hash
        );

        for (uint256 i = 0; i < gatheredValidatorsNumber; ++i) {
            delete validators[gatheredValidators[i]];
        }

        return true;
    }

    function recoverSigner(Message memory _message, bytes memory _signature) private view returns(address) {
        bytes32 messageHash = keccak256(abi.encode(
            MESSAGE_TYPEHASH,
            _message.sender,
            _message.targetAddress,
            keccak256(abi.encodePacked(_message.data)),
            _message.value,
            _message.id,
            _message.homeChainId,
            _message.foreignChainId,
            _message.hash
        ));
        bytes32 digest = _hashTypedDataV4(messageHash);

        return ECDSAUpgradeable.recover(digest, _signature);
    }
}