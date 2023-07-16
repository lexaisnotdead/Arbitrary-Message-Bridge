const { ethers } = require("hardhat");
const { upgrades } = require("hardhat");
const { expect } = require("chai");

const tokenId = 10;
const amount = 1000;
const feeAmount = 10;
const homeChainId = 1;
const foreignChainId = 2;
const requiredSignatures = 6;

async function getDomain(contractAddress) {
    return {
        name: "Receiver contract",
        version: "0.0.1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: contractAddress,
    }
}

const type = {
    ValidateMessage: [
        { name: "sender", type: "address" },
        { name: "contractAddress", type: "address" },
        { name: "data", type: "bytes" },
        { name: "value", type: "uint256" },
        { name: "chainId", type: "uint256" },
        { name: "nonce", type: "bytes32" },
    ]
}

describe("Sender only", function() {
    let Sender;
    let sender;
    let feeManagerRole;
    
    let testERC20Foreign;
    let testERC721Foreign;
    let testERC20Home;
    let testERC721Home;

    let owner;
    let alice;
    let badActor;
    let feeReceiver;
    let caller;

    before(async function() {
        [owner, alice, badActor, feeReceiver, caller] = await ethers.getSigners();

        const TestERC20 = await ethers.getContractFactory("TestERC20");
        testERC20Home = await TestERC20.deploy();
        await testERC20Home.deployed();

        testERC20Foreign = await TestERC20.deploy();
        await testERC20Foreign.deployed();

        const TestERC721 = await ethers.getContractFactory("TestERC721");
        testERC721Home = await TestERC721.deploy();
        await testERC721Home.deployed();

        testERC721Foreign = await TestERC721.deploy();
        await testERC721Foreign.deployed();

        Sender = await ethers.getContractFactory("Sender");
    });

    beforeEach(async function() {
        sender = await upgrades.deployProxy(Sender, { initializer: 'initialize', kind: 'uups' } );
        
        feeManagerRole = await sender.FEE_MANAGER_ROLE();
    });

    it("Should allow to send message", async function() {
        const data = testERC721Foreign.interface.encodeFunctionData("mint", [caller.address, tokenId]);
        const tx = await sender.connect(caller).sendMessage(testERC721Foreign.address, data, foreignChainId);
        const receipt = await tx.wait();

        const nonce = ethers.utils.solidityKeccak256(["address", "bytes", "uint256"], [testERC721Foreign.address, data, foreignChainId]);
        const message = await sender.messages(nonce);

        expect(message.sender).to.equal(caller.address);
        expect(message.contractAddress).to.equal(testERC721Foreign.address);
        expect(message.data).to.equal(data);
        expect(message.chainId).to.equal(ethers.BigNumber.from(foreignChainId));
        
        expect(receipt.events[0].args.sender).to.equal(caller.address);
        expect(receipt.events[0].args.contractAddress).to.equal(testERC721Foreign.address);
        expect(receipt.events[0].args.data).to.equal(data);
        expect(receipt.events[0].args.nonce).to.equal(nonce);
        expect(receipt.events[0].args.chainId).to.equal(foreignChainId);
    });

    it("Should allow to send ETH to execute payable message", async function() {
        const data = testERC721Foreign.interface.encodeFunctionData("mintPayable", [caller.address, tokenId]);
        const tx = await sender.connect(caller).sendMessage(testERC721Foreign.address, data, foreignChainId, { value: ethers.utils.parseEther("2") });
        const receipt = await tx.wait();

        const nonce = ethers.utils.solidityKeccak256(["address", "bytes", "uint256"], [testERC721Foreign.address, data, foreignChainId]);
        const message = await sender.messages(nonce);

        expect(message.sender).to.equal(caller.address);
        expect(message.contractAddress).to.equal(testERC721Foreign.address);
        expect(message.data).to.equal(data);
        expect(message.chainId).to.equal(ethers.BigNumber.from(foreignChainId));
        
        expect(receipt.events[0].args.sender).to.equal(caller.address);
        expect(receipt.events[0].args.contractAddress).to.equal(testERC721Foreign.address);
        expect(receipt.events[0].args.data).to.equal(data);
        expect(receipt.events[0].args.value).to.equal(ethers.utils.parseEther("2"));
        expect(receipt.events[0].args.nonce).to.equal(nonce);
        expect(receipt.events[0].args.chainId).to.equal(foreignChainId);
    });
    
    it("Should allow fee manager to set the fees", async function() {
        await sender.setFees(testERC20Home.address, amount);

        expect(await sender.feeToken()).to.equal(testERC20Home.address);
        expect(await sender.fees()).to.equal(ethers.BigNumber.from(amount));
    });

    it("Should allow fee manager to set zero fees", async function() {
        await sender.setFees(ethers.constants.AddressZero, 0);

        expect(await sender.feeToken()).to.equal(ethers.constants.AddressZero);
        expect(await sender.fees()).to.equal(ethers.BigNumber.from(0));
    });

    it("Should not allow non-fee-manager to set the fees", async function() {
        await expect(sender.connect(badActor).setFees(testERC20Home.address, amount)).to.be.rejectedWith("Caller has no fee manager role");
    });

    it("Should not allow to set fees if provided token address is address zero", async function() {
        await expect(sender.setFees(ethers.constants.AddressZero, amount)).to.be.rejectedWith("Invalid fee token address");
    });

    it("Should not allow to set zero fees if provided token address is not address zero", async function() {
        await expect(sender.setFees(testERC20Home.address, 0)).to.be.rejectedWith("fees must be greater than 0");
    });

    it("Should allow fee manager to set the fee receiver", async function() {
        const tx = await sender.setFeeReceiver(feeReceiver.address);
        const receipt = await tx.wait();

        expect(await sender.feeReceiver()).to.equal(feeReceiver.address);
        expect(receipt.events[0].args.oldFeeReceiver).to.equal(ethers.constants.AddressZero);
        expect(receipt.events[0].args.newFeeReceiver).to.equal(feeReceiver.address);
    });

    it("Should not allow non-fee-managet to set the fee receiver", async function() {
        await expect(sender.connect(badActor).setFeeReceiver(feeReceiver.address)).to.be.rejectedWith("Caller has no fee manager role");
    });

    it("Should not allow to set address zero as a fee receiver", async function() {
        await expect(sender.setFeeReceiver(ethers.constants.AddressZero)).to.be.rejectedWith("Invalid fee receiver address");
    });

    it("Should allow admin to set pause", async function() {
        await sender.setPause(true);

        expect(await sender.isPaused()).to.equal(true);
    });

    it("Should not allow non-admin to set pause", async function() {
        await expect(sender.connect(badActor).setPause(true)).to.be.rejectedWith("Caller has no admin role");
    });

    it("Should not allow to send messages if the sender is paused", async function() {
        await sender.setPause(true);

        const data = testERC721Foreign.interface.encodeFunctionData("mint", [caller.address, tokenId]);
        await expect(sender.connect(caller).sendMessage(testERC721Foreign.address, data, foreignChainId)).to.be.rejectedWith("Sender: Service is paused");
    });

    it("Should allow to send message with fees", async function() {
        await sender.setFees(testERC20Home.address, feeAmount);
        await sender.setFeeReceiver(feeReceiver.address);

        expect(await sender.feeToken()).to.equal(testERC20Home.address);
        expect(await sender.fees()).to.equal(ethers.BigNumber.from(feeAmount));
        expect(await sender.feeReceiver()).to.equal(feeReceiver.address);

        await testERC20Home.transfer(caller.address, feeAmount);
        await testERC20Home.connect(caller).approve(sender.address, feeAmount);

        const data = testERC721Foreign.interface.encodeFunctionData("mint", [caller.address, tokenId]);
        await sender.connect(caller).sendMessage(testERC721Foreign.address, data, foreignChainId);

        expect(await testERC20Home.balanceOf(feeReceiver.address)).to.equal(ethers.BigNumber.from(feeAmount));
        expect(await testERC20Home.balanceOf(caller.address)).to.equal(ethers.BigNumber.from(0));

        const nonce = ethers.utils.solidityKeccak256(["address", "bytes", "uint256"], [testERC721Foreign.address, data, foreignChainId]);
        const message = await sender.messages(nonce);

        expect(message.sender).to.equal(caller.address);
        expect(message.contractAddress).to.equal(testERC721Foreign.address);
        expect(message.data).to.equal(data);
        expect(message.chainId).to.equal(ethers.BigNumber.from(foreignChainId));
    });

    it("Should not allow to send message with fees if the sender contract has no approval to manage user's tokens", async function() {
        await sender.setFees(testERC20Home.address, feeAmount);
        await sender.setFeeReceiver(feeReceiver.address);

        const data = testERC721Foreign.interface.encodeFunctionData("mint", [caller.address, tokenId]);
        await expect(sender.connect(caller).sendMessage(testERC721Foreign.address, data, foreignChainId)).to.be.rejectedWith("The sender does not have approval to spend the user's tokens");
    });

    it("Should not allow to send message twice", async function() {
        const data = testERC721Foreign.interface.encodeFunctionData("mint", [caller.address, tokenId]);
        await sender.connect(caller).sendMessage(testERC721Foreign.address, data, foreignChainId);

        await expect(sender.connect(caller).sendMessage(testERC721Foreign.address, data, foreignChainId)).to.be.rejectedWith("Message already used");
    });

    it("Should not allow to send message to address zero", async function() {
        const data = testERC721Foreign.interface.encodeFunctionData("mint", [caller.address, tokenId]);

        await expect(sender.connect(caller).sendMessage(ethers.constants.AddressZero, data, foreignChainId)).to.be.rejectedWith("Invalid foreign contract address");
    });

    it("Should allow admin to set fee manager", async function() {
        await sender.grantRole(feeManagerRole, alice.address);

        expect(await sender.hasRole(feeManagerRole, alice.address)).to.equal(true);
    });

    it("Should not allow non-admin to set fee manager", async function() {
        await expect(sender.connect(badActor).grantRole(feeManagerRole, alice.address)).to.be.rejected;
    });
});

describe("Receiver only", function() {
    let Receiver;
    let receiver;

    let TestERC20;
    let TestERC721;
    let testERC20Foreign;
    let testERC721Foreign;
    let testERC20Home;
    let testERC721Home;

    let owner;
    let alice;
    let badActor;
    let feeReceiver;
    let caller;

    let validator1;
    let validator2;
    let validator3;
    let validator4;
    let validator5;
    let validator6;
    let validator7;
    let validator8;
    let validator9;
    let validator10;

    let validators = [];
    let validatorRole;

    before(async function() {
        [owner, alice, badActor, feeReceiver, caller,
        validator1, validator2, validator3, validator4, validator5, validator6, validator7, validator8, validator9, validator10] = await ethers.getSigners();
        
        validators = [
            validator1.address,
            validator2.address,
            validator3.address,
            validator4.address,
            validator5.address,
            validator6.address,
            validator7.address,
            validator8.address,
            validator9.address,
            validator10.address
        ];

        console.log(validators);
        TestERC20 = await ethers.getContractFactory("TestERC20");
        TestERC721 = await ethers.getContractFactory("TestERC721");

        Receiver = await ethers.getContractFactory("Receiver");
    });

    beforeEach(async function() {
        receiver = await upgrades.deployProxy(Receiver, [validators, requiredSignatures], { initializer: 'initialize', kind: 'uups' });
        validatorRole = await receiver.VALIDATOR_ROLE();

        testERC20Home = await TestERC20.deploy();
        await testERC20Home.deployed();

        testERC20Foreign = await TestERC20.deploy();
        await testERC20Foreign.deployed();

        testERC721Home = await TestERC721.deploy();
        await testERC721Home.deployed();

        testERC721Foreign = await TestERC721.deploy();
        await testERC721Foreign.deployed();

        for (const validator of validators) {
            await receiver.grantRole(validatorRole, validator);
        }
    });

    it("Should allow admin to set pause", async function() {
        await receiver.setPause(true);

        expect(await receiver.isPaused()).to.equal(true);
    });

    it("Should not allow non-admin to set pause", async function() {
        await expect(receiver.connect(badActor).setPause(true)).to.be.rejectedWith("Caller has no admin role");
    });

    it("Should not allow to execute messages if the receiver is paused", async function() {
        await receiver.setPause(true);

        const _data = testERC721Foreign.interface.encodeFunctionData("mint", [caller.address, tokenId]);
        const _nonce = ethers.utils.solidityKeccak256(["address", "bytes", "uint256"], [testERC721Foreign.address, _data, foreignChainId]);

        const domain = await getDomain(receiver.address);
        const message = {
            sender: caller.address,
            contractAddress: testERC721Foreign.address,
            data: _data,
            value: ethers.BigNumber.from(0),
            chainId: foreignChainId,
            nonce: _nonce,
        };

        const signature = await validator1._signTypedData(domain, type, message);

        await expect(receiver.connect(caller).executeMessage([signature], message)).to.be.revertedWith("Receiver: Service is paused");
    });

    it("Should allow admin to remove validators", async function() {
        const _validators = [validator1.address, validator2.address];

        const tx = await receiver.removeValidators(_validators);
        const receipt = await tx.wait();

        expect(receipt.events[2].args.validators[0]).to.equal(_validators[0]);
        expect(receipt.events[2].args.validators[1]).to.equal(_validators[1]);
        expect(await receiver.getRoleMemberCount(validatorRole)).to.equal(ethers.BigNumber.from(8));
    });

    it("Should not allow non-admin to remove validators", async function() {
        const _validators = [validator1.address, validator2.address];

        await expect(receiver.connect(badActor).removeValidators(_validators)).to.be.revertedWith("Caller has no admin role");
    });

    it("Should not allow removing validators if there are fewer validators than required after removing", async function() {
        const _validators = [validator1.address, validator2.address, validator3.address, validator4.address, validator5.address];

        await expect(receiver.removeValidators(_validators)).to.be.revertedWith("Validators cannot be less than the number of required signatures");
    });

    it("Should allow admin to set required number of signatures", async function() {
        const tx = await receiver.setRequiredSignatures(3);

        expect(await receiver.requiredSignatures()).to.equal(3);
        await expect(tx).to.emit(receiver, "NewRequiredSignatures").withArgs(requiredSignatures, 3);
    });

    it("Should not allow non-admin to set required number of signatures", async function() {
        await expect(receiver.connect(badActor).setRequiredSignatures(3)).to.be.revertedWith("Caller has no admin role");
    });

    it("Should not allow to set required number of signatures as 0", async function() {
        await expect(receiver.setRequiredSignatures(0)).to.be.revertedWith("The number of required signatures must be more than 0");
    });

    it("Should allow to execute message if it has enough signatures", async function() {
        await receiver.setRequiredSignatures(3);

        const _data = testERC721Foreign.interface.encodeFunctionData("mint", [caller.address, tokenId]);
        const _nonce = ethers.utils.solidityKeccak256(["address", "bytes", "uint256"], [testERC721Foreign.address, _data, foreignChainId]);

        const domain = await getDomain(receiver.address);
        const message = {
            sender: caller.address,
            contractAddress: testERC721Foreign.address,
            data: _data,
            value: ethers.BigNumber.from(0),
            chainId: foreignChainId,
            nonce: _nonce,
        };

        const signature1 = await validator1._signTypedData(domain, type, message);
        const signature2 = await validator2._signTypedData(domain, type, message);
        const signature3 = await validator3._signTypedData(domain, type, message);

        const tx = await receiver.connect(caller).executeMessage([signature1, signature2, signature3], message);
        const validatedMessage = await receiver.getMessage(message.nonce);

        expect(await testERC721Foreign.ownerOf(tokenId)).to.equal(caller.address);
        expect(await receiver.connect(caller).executedMessages(_nonce)).to.equal(true);
        
        expect(validatedMessage.validators).to.deep.equal([validator1.address, validator2.address, validator3.address]);
        expect(validatedMessage.sender).to.equal(caller.address);
        expect(validatedMessage.contractAddress).to.equal(testERC721Foreign.address);
        expect(validatedMessage.data).to.equal(_data);
        expect(validatedMessage.value).to.equal(ethers.BigNumber.from(0));
        expect(validatedMessage.chainId).to.equal(ethers.BigNumber.from(foreignChainId));

        await expect(tx).to.emit(receiver, "MessageExecuted").withArgs(
            [validator1.address, validator2.address, validator3.address],
            caller.address,
            testERC721Foreign.address,
            _data,
            ethers.BigNumber.from(0),
            ethers.BigNumber.from(foreignChainId),
            _nonce
        );
    });

    it("Should allow to execute payable message with ETH", async function() {
        await receiver.setRequiredSignatures(3);
        await caller.sendTransaction( {to: receiver.address, value: ethers.utils.parseEther("4") } );

        const _data = testERC721Foreign.interface.encodeFunctionData("mintPayable", [caller.address, tokenId]);
        const _nonce = ethers.utils.solidityKeccak256(["address", "bytes", "uint256"], [testERC721Foreign.address, _data, foreignChainId]);

        const domain = await getDomain(receiver.address);
        const message = {
            sender: caller.address,
            contractAddress: testERC721Foreign.address,
            data: _data,
            value: ethers.utils.parseEther("2"),
            chainId: foreignChainId,
            nonce: _nonce,
        };

        const signature1 = await validator1._signTypedData(domain, type, message);
        const signature2 = await validator2._signTypedData(domain, type, message);
        const signature3 = await validator3._signTypedData(domain, type, message);

        const tx = await receiver.connect(caller).executeMessage([signature1, signature2, signature3], message);
        const validatedMessage = await receiver.getMessage(message.nonce);

        expect(await testERC721Foreign.ownerOf(tokenId)).to.equal(caller.address);
        expect(await receiver.connect(caller).executedMessages(_nonce)).to.equal(true);
        
        expect(validatedMessage.validators).to.deep.equal([validator1.address, validator2.address, validator3.address]);
        expect(validatedMessage.sender).to.equal(caller.address);
        expect(validatedMessage.contractAddress).to.equal(testERC721Foreign.address);
        expect(validatedMessage.data).to.equal(_data);
        expect(validatedMessage.value).to.equal(ethers.utils.parseEther("2"));
        expect(validatedMessage.chainId).to.equal(ethers.BigNumber.from(foreignChainId));

        await expect(tx).to.emit(receiver, "MessageExecuted").withArgs(
            [validator1.address, validator2.address, validator3.address],
            caller.address,
            testERC721Foreign.address,
            _data,
            ethers.utils.parseEther("2"),
            ethers.BigNumber.from(foreignChainId),
            _nonce
        );
    });

    it("Should not allow to execute non-payable message with ETH", async function() {
        await receiver.setRequiredSignatures(3);
        await caller.sendTransaction( {to: receiver.address, value: ethers.utils.parseEther("4") } );

        const _data = testERC721Foreign.interface.encodeFunctionData("mint", [caller.address, tokenId]);
        const _nonce = ethers.utils.solidityKeccak256(["address", "bytes", "uint256"], [testERC721Foreign.address, _data, foreignChainId]);

        const domain = await getDomain(receiver.address);
        const message = {
            sender: caller.address,
            contractAddress: testERC721Foreign.address,
            data: _data,
            value: ethers.utils.parseEther("2"),
            chainId: foreignChainId,
            nonce: _nonce,
        };

        const signature1 = await validator1._signTypedData(domain, type, message);
        const signature2 = await validator2._signTypedData(domain, type, message);
        const signature3 = await validator3._signTypedData(domain, type, message);

        const tx = await receiver.connect(caller).executeMessage([signature1, signature2, signature3], message);
        expect(await receiver.connect(caller).executedMessages(_nonce)).to.equal(false);
        
        await expect(tx).to.emit(receiver, "MessageFailed").withArgs(
            caller.address,
            testERC721Foreign.address,
            _data,
            ethers.utils.parseEther("2"),
            ethers.BigNumber.from(foreignChainId),
            _nonce
        );
    });

    it("Should not allow to execute message twice", async function() {
        await receiver.setRequiredSignatures(3);

        const _data = testERC721Foreign.interface.encodeFunctionData("mint", [caller.address, tokenId]);
        const _nonce = ethers.utils.solidityKeccak256(["address", "bytes", "uint256"], [testERC721Foreign.address, _data, foreignChainId]);

        const domain = await getDomain(receiver.address);
        const message = {
            sender: caller.address,
            contractAddress: testERC721Foreign.address,
            data: _data,
            value: ethers.BigNumber.from(0),
            chainId: foreignChainId,
            nonce: _nonce,
        };

        const signature1 = await validator1._signTypedData(domain, type, message);
        const signature2 = await validator2._signTypedData(domain, type, message);
        const signature3 = await validator3._signTypedData(domain, type, message);

        await receiver.connect(caller).executeMessage([signature1, signature2, signature3], message);
        await expect(receiver.connect(caller).executeMessage([signature1, signature2, signature3], message)).to.be.revertedWith("Message already executed");
    });

    it("Should not allow to non original sender to execute message", async function() {
        await receiver.setRequiredSignatures(3);

        const _data = testERC721Foreign.interface.encodeFunctionData("mint", [caller.address, tokenId]);
        const _nonce = ethers.utils.solidityKeccak256(["address", "bytes", "uint256"], [testERC721Foreign.address, _data, foreignChainId]);

        const domain = await getDomain(receiver.address);
        const message = {
            sender: caller.address,
            contractAddress: testERC721Foreign.address,
            data: _data,
            value: ethers.BigNumber.from(0),
            chainId: foreignChainId,
            nonce: _nonce,
        };

        const signature1 = await validator1._signTypedData(domain, type, message);
        const signature2 = await validator2._signTypedData(domain, type, message);
        const signature3 = await validator3._signTypedData(domain, type, message);

        await expect(receiver.connect(badActor).executeMessage([signature1, signature2, signature3], message)).to.be.revertedWith("Only the original sender can execute the message. User addresses in different chains must be the same");
    });

    it("Should not allow to execute message without enough signatures: Case #1 - not enough validators signed", async function() {
        const _data = testERC721Foreign.interface.encodeFunctionData("mint", [caller.address, tokenId]);
        const _nonce = ethers.utils.solidityKeccak256(["address", "bytes", "uint256"], [testERC721Foreign.address, _data, foreignChainId]);

        const domain = await getDomain(receiver.address);
        const message = {
            sender: caller.address,
            contractAddress: testERC721Foreign.address,
            data: _data,
            value: ethers.BigNumber.from(0),
            chainId: foreignChainId,
            nonce: _nonce,
        };

        const signature1 = await validator1._signTypedData(domain, type, message);
        const signature2 = await validator2._signTypedData(domain, type, message);
        const signature3 = await validator3._signTypedData(domain, type, message);

        await expect(receiver.connect(caller).executeMessage([signature1, signature2, signature3], message)).to.be.revertedWith("Not enough signatures");
    });

    it("Should not allow to execute message without enough signatures: Case #2 - some of signers are not validators", async function() {
        await receiver.setRequiredSignatures(3);

        const _data = testERC721Foreign.interface.encodeFunctionData("mint", [caller.address, tokenId]);
        const _nonce = ethers.utils.solidityKeccak256(["address", "bytes", "uint256"], [testERC721Foreign.address, _data, foreignChainId]);

        const domain = await getDomain(receiver.address);
        const message = {
            sender: caller.address,
            contractAddress: testERC721Foreign.address,
            data: _data,
            value: ethers.BigNumber.from(0),
            chainId: foreignChainId,
            nonce: _nonce,
        };

        const signature1 = await badActor._signTypedData(domain, type, message);
        const signature2 = await validator2._signTypedData(domain, type, message);
        const signature3 = await validator3._signTypedData(domain, type, message);

        await expect(receiver.connect(caller).executeMessage([signature1, signature2, signature3], message)).to.be.revertedWith("Not enough signatures");
    });

    it("Should not allow to execute message without enough signatures: Case #3 - one validator signed multiple times", async function() {
        await receiver.setRequiredSignatures(3);

        const _data = testERC721Foreign.interface.encodeFunctionData("mint", [caller.address, tokenId]);
        const _nonce = ethers.utils.solidityKeccak256(["address", "bytes", "uint256"], [testERC721Foreign.address, _data, foreignChainId]);

        const domain = await getDomain(receiver.address);
        const message = {
            sender: caller.address,
            contractAddress: testERC721Foreign.address,
            data: _data,
            value: ethers.BigNumber.from(0),
            chainId: foreignChainId,
            nonce: _nonce,
        };

        const signature1 = await validator1._signTypedData(domain, type, message);
        const signature2 = await validator1._signTypedData(domain, type, message);
        const signature3 = await validator1._signTypedData(domain, type, message);

        await expect(receiver.connect(caller).executeMessage([signature1, signature2, signature3], message)).to.be.revertedWith("Not enough signatures");
    });

    it("Should not allow to execute the message if the provided data is invalid", async function() {
        await receiver.setRequiredSignatures(3);

        const _data = ethers.utils.hexZeroPad(ethers.utils.hexlify(0), 32);
        const _nonce = ethers.utils.solidityKeccak256(["address", "bytes", "uint256"], [testERC721Foreign.address, _data, foreignChainId]);

        const domain = await getDomain(receiver.address);
        const message = {
            sender: caller.address,
            contractAddress: testERC721Foreign.address,
            data: _data,
            value: ethers.BigNumber.from(0),
            chainId: foreignChainId,
            nonce: _nonce,
        };

        const signature1 = await validator1._signTypedData(domain, type, message);
        const signature2 = await validator2._signTypedData(domain, type, message);
        const signature3 = await validator3._signTypedData(domain, type, message);

        expect(await receiver.connect(caller).callStatic.executeMessage([signature1, signature2, signature3], message)).to.equal(false);
    });

    it("Should not allow to execute the message if the provided message is invalid: Case #1 - trying to transfer token that is already minted on the Foreign Chain", async function() {
        await receiver.setRequiredSignatures(3);

        await testERC721Foreign.mint(alice.address, tokenId);
        const _data = testERC721Foreign.interface.encodeFunctionData("mint", [caller.address, tokenId]);
        const _nonce = ethers.utils.solidityKeccak256(["address", "bytes", "uint256"], [testERC721Foreign.address, _data, foreignChainId]);

        const domain = await getDomain(receiver.address);
        const message = {
            sender: caller.address,
            contractAddress: testERC721Foreign.address,
            data: _data,
            value: ethers.BigNumber.from(0),
            chainId: foreignChainId,
            nonce: _nonce,
        };

        const signature1 = await validator1._signTypedData(domain, type, message);
        const signature2 = await validator2._signTypedData(domain, type, message);
        const signature3 = await validator3._signTypedData(domain, type, message);

        expect(await receiver.connect(caller).callStatic.executeMessage([signature1, signature2, signature3], message)).to.equal(false);
    });

    it("Should not allow to execute the message if the provided message is invalid: Case #2 - caller contract has no provided function", async function() {
        await receiver.setRequiredSignatures(3);

        const _data = testERC20Foreign.interface.encodeFunctionData("increaseAllowance", [caller.address, tokenId]);
        const _nonce = ethers.utils.solidityKeccak256(["address", "bytes", "uint256"], [testERC721Foreign.address, _data, foreignChainId]);

        const domain = await getDomain(receiver.address);
        const message = {
            sender: caller.address,
            contractAddress: testERC721Foreign.address,
            data: _data,
            value: ethers.BigNumber.from(0),
            chainId: foreignChainId,
            nonce: _nonce,
        };

        const signature1 = await validator1._signTypedData(domain, type, message);
        const signature2 = await validator2._signTypedData(domain, type, message);
        const signature3 = await validator3._signTypedData(domain, type, message);

        expect(await receiver.connect(caller).callStatic.executeMessage([signature1, signature2, signature3], message)).to.equal(false);
    });
});

describe("Sender and Receiver", function() {
    let Receiver;
    let receiver;

    let Sender;
    let sender;

    let TestERC20;
    let TestERC721;
    let testERC20Foreign;
    let testERC721Foreign;
    let testERC20Home;
    let testERC721Home;

    let owner;
    let feeReceiver;
    let caller;

    let validator1;
    let validator2;
    let validator3;
    let validator4;
    let validator5;
    let validator6;
    let validator7;
    let validator8;
    let validator9;
    let validator10;
    let validators = [];
    
    let validatorRole;

    before(async function() {
        [owner, feeReceiver, caller,
        validator1, validator2, validator3, validator4, validator5, validator6, validator7, validator8, validator9, validator10] = await ethers.getSigners();
        
        validators = [
            validator1.address,
            validator2.address,
            validator3.address,
            validator4.address,
            validator5.address,
            validator6.address,
            validator7.address,
            validator8.address,
            validator9.address,
            validator10.address
        ]
        
        TestERC20 = await ethers.getContractFactory("TestERC20");
        TestERC721 = await ethers.getContractFactory("TestERC721");

        Receiver = await ethers.getContractFactory("Receiver");
        Sender = await ethers.getContractFactory("Sender");
    });

    beforeEach(async function() {
        receiver = await upgrades.deployProxy(Receiver, [validators, requiredSignatures], { initializer: 'initialize', kind: 'uups' });
        validatorRole = await receiver.VALIDATOR_ROLE();

        sender = await upgrades.deployProxy(Sender, { initializer: 'initialize', kind: 'uups' } );    

        testERC20Home = await TestERC20.deploy();
        await testERC20Home.deployed();

        testERC20Foreign = await TestERC20.deploy();
        await testERC20Foreign.deployed();

        testERC721Home = await TestERC721.deploy();
        await testERC721Home.deployed();

        testERC721Foreign = await TestERC721.deploy();
        await testERC721Foreign.deployed();

        for (const validator of validators) {
            await receiver.grantRole(validatorRole, validator);
        }

        await sender.setFees(testERC20Home.address, feeAmount);
        await sender.setFeeReceiver(feeReceiver.address);
    });

    it("Should allow to transfer tokens only using informations from events", async function() {
        // Sender part - Chain A
        await testERC20Home.transfer(caller.address, feeAmount);
        await testERC20Home.connect(caller).approve(sender.address, feeAmount);

        const _data = testERC721Foreign.interface.encodeFunctionData("mint", [caller.address, tokenId]);
        const _nonce = ethers.utils.solidityKeccak256(["address", "bytes", "uint256"], [testERC721Foreign.address, _data, foreignChainId]);
        const txSender = await sender.connect(caller).sendMessage(testERC721Foreign.address, _data, foreignChainId);
        const receipt = await txSender.wait();

        await expect(txSender).to.emit(sender, "RequestForSignature").withArgs(
            caller.address,
            testERC721Foreign.address,
            _data,
            ethers.BigNumber.from(0),
            _nonce,
            ethers.BigNumber.from(foreignChainId),
        );
        expect(await testERC20Home.balanceOf(feeReceiver.address)).to.equal(ethers.BigNumber.from(feeAmount));

        // Receiver part - Chain B
        const domain = await getDomain(receiver.address);
        const message = {
            sender: receipt.events[2].args.sender,
            contractAddress: receipt.events[2].args.contractAddress,
            data: receipt.events[2].args.data,
            value: receipt.events[2].args.value,
            chainId: receipt.events[2].args.chainId,
            nonce: receipt.events[2].args.nonce,
        };

        const signature1 = await validator1._signTypedData(domain, type, message);
        const signature2 = await validator2._signTypedData(domain, type, message);
        const signature3 = await validator3._signTypedData(domain, type, message);
        const signature4 = await validator4._signTypedData(domain, type, message);
        const signature5 = await validator5._signTypedData(domain, type, message);
        const signature6 = await validator6._signTypedData(domain, type, message);

        const txReceiver = await receiver.connect(caller).executeMessage([signature1, signature2, signature3, signature4, signature5, signature6], message);

        await expect(txReceiver).to.emit(receiver, "MessageExecuted").withArgs(
            [validator1.address, validator2.address, validator3.address, validator4.address, validator5.address, validator6.address],
            caller.address,
            testERC721Foreign.address,
            _data,
            ethers.BigNumber.from(0),
            ethers.BigNumber.from(foreignChainId),
            _nonce
        );

        expect(await testERC721Foreign.ownerOf(tokenId)).to.equal(caller.address);
    });

    it("Should allow to transfer tokens only using information stored on-chain", async function() {
        // Sender paart - Chain A
        await testERC20Home.transfer(caller.address, feeAmount);
        await testERC20Home.connect(caller).approve(sender.address, feeAmount);

        const _data = testERC721Foreign.interface.encodeFunctionData("mint", [caller.address, tokenId]);
        const _nonce = ethers.utils.solidityKeccak256(["address", "bytes", "uint256"], [testERC721Foreign.address, _data, foreignChainId]);
        const txSender = await sender.connect(caller).sendMessage(testERC721Foreign.address, _data, foreignChainId);
        const messageFromSender = await sender.messages(_nonce);

        await expect(txSender).to.emit(sender, "RequestForSignature").withArgs(
            caller.address,
            testERC721Foreign.address,
            _data,
            ethers.BigNumber.from(0),
            _nonce,
            ethers.BigNumber.from(foreignChainId),
        );
        expect(await testERC20Home.balanceOf(feeReceiver.address)).to.equal(ethers.BigNumber.from(feeAmount));

        // Receiver part - Chain B
        const domain = await getDomain(receiver.address);
        const message = {
            sender: messageFromSender.sender,
            contractAddress: messageFromSender.contractAddress,
            data: messageFromSender.data,
            value: messageFromSender.value,
            chainId: messageFromSender.chainId,
            nonce: _nonce,
        };

        const signature1 = await validator1._signTypedData(domain, type, message);
        const signature2 = await validator2._signTypedData(domain, type, message);
        const signature3 = await validator3._signTypedData(domain, type, message);
        const signature4 = await validator4._signTypedData(domain, type, message);
        const signature5 = await validator5._signTypedData(domain, type, message);
        const signature6 = await validator6._signTypedData(domain, type, message);

        const txReceiver = await receiver.connect(caller).executeMessage([signature1, signature2, signature3, signature4, signature5, signature6], message);
        
        await expect(txReceiver).to.emit(receiver, "MessageExecuted").withArgs(
            [validator1.address, validator2.address, validator3.address, validator4.address, validator5.address, validator6.address],
            caller.address,
            testERC721Foreign.address,
            _data,
            ethers.BigNumber.from(0),
            ethers.BigNumber.from(foreignChainId),
            _nonce
        );

        expect(await testERC721Foreign.ownerOf(tokenId)).to.equal(caller.address);
    });
});