const { ethers } = require("hardhat");
const { upgrades } = require("hardhat");
const { expect } = require("chai");

const tokenId = 10;
const amount = 1000;
const feeAmount = 10;
let homeChainId;
let foreignChainId;

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
        { name: "targetAddress", type: "address" },
        { name: "data", type: "bytes" },
        { name: "value", type: "uint256" },
        { name: "id", type: "uint256" },
        { name: "homeChainId", type: "uint256" },
        { name: "foreignChainId", type: "uint256" },
        { name: "hash", type: "bytes32" },
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
        testERC20Home = await TestERC20.deploy("Test token", "TSTKN");
        await testERC20Home.deployed();

        testERC20Foreign = await TestERC20.deploy("Test token", "TSTKN");
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
        homeChainId = (await ethers.provider.getNetwork()).chainId;
        foreignChainId = (await ethers.provider.getNetwork()).chainId;
        
        feeManagerRole = await sender.FEE_MANAGER_ROLE();
    });

    it("Should allow to send message", async function() {
        const data = testERC721Foreign.interface.encodeFunctionData("mint", [caller.address, tokenId]);
        const messageId = await sender.nextMessageId();
        const tx = await sender.connect(caller).sendMessage(testERC721Foreign.address, data, ethers.BigNumber.from(0), foreignChainId);
        const receipt = await tx.wait();

        const hash = ethers.utils.solidityKeccak256(["address", "address", "bytes", "uint256", "uint256", "uint256", "uint256"], [caller.address, testERC721Foreign.address, data, ethers.BigNumber.from(0), messageId, homeChainId, foreignChainId]);
        const message = await sender.messages(messageId);

        expect(message.sender).to.equal(caller.address);
        expect(message.targetAddress).to.equal(testERC721Foreign.address);
        expect(message.data).to.equal(data);
        expect(message.homeChainId).to.equal(ethers.BigNumber.from(homeChainId));
        expect(message.foreignChainId).to.equal(ethers.BigNumber.from(foreignChainId));
        
        expect(tx).to.emit(sender, "RequestForSignature");
        expect(receipt.events[0].args.sender).to.equal(caller.address);
        expect(receipt.events[0].args.targetAddress).to.equal(testERC721Foreign.address);
        expect(receipt.events[0].args.data).to.equal(data);
        expect(receipt.events[0].args.hash).to.equal(hash);
        expect(receipt.events[0].args.homeChainId).to.equal(homeChainId);
        expect(receipt.events[0].args.foreignChainId).to.equal(foreignChainId );
    });
    
    it("Should allow fee manager to set the fees", async function() {
        await sender.setFees(testERC20Home.address, amount);
        await caller.sendTransaction({
            to: caller.address,
            value: ethers.utils.parseEther("0"),
        });

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

        await caller.sendTransaction({
            to: caller.address,
            value: ethers.utils.parseEther("0"),
        });

        expect(await sender.isPaused()).to.equal(true);
    });

    it("Should not allow non-admin to set pause", async function() {
        await expect(sender.connect(badActor).setPause(true)).to.be.rejectedWith("Caller has no admin role");
    });

    it("Should not allow to send messages if the sender is paused", async function() {
        await sender.setPause(true);

        await caller.sendTransaction({
            to: caller.address,
            value: ethers.utils.parseEther("0"),
        });

        const data = testERC721Foreign.interface.encodeFunctionData("mint", [caller.address, tokenId]);
        await expect(sender.connect(caller).sendMessage(testERC721Foreign.address, data, ethers.BigNumber.from(0), foreignChainId)).to.be.rejectedWith("Sender: Service is paused");
    });

    it("Should allow to send message with fees", async function() {
        await sender.setFees(testERC20Home.address, feeAmount);
        await caller.sendTransaction({
            to: caller.address,
            value: ethers.utils.parseEther("0"),
        });

        await sender.setFeeReceiver(feeReceiver.address);
        await caller.sendTransaction({
            to: caller.address,
            value: ethers.utils.parseEther("0"),
        });

        expect(await sender.feeToken()).to.equal(testERC20Home.address);
        expect(await sender.fees()).to.equal(ethers.BigNumber.from(feeAmount));
        expect(await sender.feeReceiver()).to.equal(feeReceiver.address);

        await testERC20Home.transfer(caller.address, feeAmount);
        await caller.sendTransaction({
            to: caller.address,
            value: ethers.utils.parseEther("0"),
        });

        await testERC20Home.connect(caller).approve(sender.address, feeAmount);

        const data = testERC721Foreign.interface.encodeFunctionData("mint", [caller.address, tokenId]);
        const messageId = await sender.nextMessageId();
        await sender.connect(caller).sendMessage(testERC721Foreign.address, data, ethers.BigNumber.from(0), foreignChainId);
        await caller.sendTransaction({
            to: caller.address,
            value: ethers.utils.parseEther("0"),
        });

        expect(await testERC20Home.balanceOf(feeReceiver.address)).to.equal(ethers.BigNumber.from(feeAmount));
        expect(await testERC20Home.balanceOf(caller.address)).to.equal(ethers.BigNumber.from(0));

        const message = await sender.messages(messageId);
        expect(message.sender).to.equal(caller.address);
        expect(message.targetAddress).to.equal(testERC721Foreign.address);
        expect(message.data).to.equal(data);
        expect(message.homeChainId).to.equal(ethers.BigNumber.from(homeChainId));
        expect(message.foreignChainId).to.equal(ethers.BigNumber.from(foreignChainId));
    });

    it("Should not allow to send message with fees if the sender contract has no approval to manage user's tokens", async function() {
        await sender.setFees(testERC20Home.address, feeAmount);
        await sender.setFeeReceiver(feeReceiver.address);

        const data = testERC721Foreign.interface.encodeFunctionData("mint", [caller.address, tokenId]);
        await expect(sender.connect(caller).sendMessage(testERC721Foreign.address, data, ethers.BigNumber.from(0), foreignChainId)).to.be.rejectedWith("Sender contract does not have approval to spend the user's tokens");
    });

    it("Should not allow to send message to address zero", async function() {
        const data = testERC721Foreign.interface.encodeFunctionData("mint", [caller.address, tokenId]);

        await expect(sender.connect(caller).sendMessage(ethers.constants.AddressZero, data, ethers.BigNumber.from(0), foreignChainId)).to.be.rejectedWith("Invalid foreign contract address");
    });

    it("Should allow admin to set fee manager", async function() {
        await sender.grantRole(feeManagerRole, alice.address);

        await caller.sendTransaction({
            to: caller.address,
            value: ethers.utils.parseEther("0"),
        });


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
        ]
        
        TestERC20 = await ethers.getContractFactory("TestERC20");
        TestERC721 = await ethers.getContractFactory("TestERC721");

        Receiver = await ethers.getContractFactory("Receiver");
    });

    beforeEach(async function() {
        receiver = await upgrades.deployProxy(Receiver, [validators, ethers.BigNumber.from(1), ethers.BigNumber.from(9)], { initializer: 'initialize', kind: 'uups' });
        validatorRole = await receiver.VALIDATOR_ROLE();

        testERC20Home = await TestERC20.deploy("Test token", "TSTKN");
        await testERC20Home.deployed();

        testERC20Foreign = await TestERC20.deploy("Test token", "TSTKN");
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
        await caller.sendTransaction({
            to: caller.address,
            value: ethers.utils.parseEther("0"),
        });

        await caller.sendTransaction({
            to: caller.address,
            value: ethers.utils.parseEther("0"),
        });

        expect(await receiver.isPaused()).to.equal(true);
    });

    it("Should not allow non-admin to set pause", async function() {
        await expect(receiver.connect(badActor).setPause(true)).to.be.rejectedWith("Caller has no admin role");
    });

    it("Should not allow to execute messages if the receiver is paused", async function() {
        await receiver.setPause(true);
        await caller.sendTransaction({
            to: caller.address,
            value: ethers.utils.parseEther("0"),
        });
        await caller.sendTransaction({
            to: caller.address,
            value: ethers.utils.parseEther("0"),
        });

        const _data = testERC721Foreign.interface.encodeFunctionData("mint", [caller.address, tokenId]);
        const _hash = ethers.utils.solidityKeccak256(["address", "address", "bytes", "uint256", "uint256", "uint256", "uint256"], [caller.address, testERC721Foreign.address, _data, ethers.BigNumber.from(0), ethers.BigNumber.from(1), homeChainId, foreignChainId]);

        const domain = await getDomain(receiver.address);
        const message = {
            sender: caller.address,
            targetAddress: testERC721Foreign.address,
            data: _data,
            value: ethers.BigNumber.from(0),
            id: ethers.BigNumber.from(1),
            homeChainId: homeChainId,
            foreignChainId: foreignChainId,
            hash: _hash,
        };

        const signature = await validator1._signTypedData(domain, type, message);
        await expect(receiver.connect(caller).executeMessage([signature], message)).to.be.revertedWith("Receiver: Service is paused");
    });

    it("Should allow admin to remove validators", async function() {
        await receiver.revokeRole(validatorRole, validator1.address);
        await caller.sendTransaction({
            to: caller.address,
            value: ethers.utils.parseEther("0"),
        });
        await caller.sendTransaction({
            to: caller.address,
            value: ethers.utils.parseEther("0"),
        });

        expect(await receiver.getRoleMemberCount(validatorRole)).to.equal(ethers.BigNumber.from(9));
    });

    it("Should not allow non-admin to remove validators", async function() {
        await expect(receiver.connect(badActor).revokeRole(validatorRole, validator1.address)).to.be.reverted;;
    });

    it("Should not allow removing validators if there are fewer validators than required after removing", async function() {
        await receiver.revokeRole(validatorRole, validator1.address);
        await caller.sendTransaction({
            to: caller.address,
            value: ethers.utils.parseEther("0"),
        });
        await caller.sendTransaction({
            to: caller.address,
            value: ethers.utils.parseEther("0"),
        });

        await expect(receiver.revokeRole(validatorRole, validator2.address)).to.be.revertedWith("bridge validator consensus drops below 1");
    });

    it("Should allow admin to set required number of signatures", async function() {
        const tx = await receiver.setValidatorRatio(ethers.BigNumber.from(2), ethers.BigNumber.from(9));
        
        await expect(tx).to.emit(receiver, "NewValidatorThresholdRatio").withArgs(ethers.BigNumber.from(2), ethers.BigNumber.from(9));
    });

    it("Should not allow non-admin to set required number of signatures", async function() {
        await expect(receiver.connect(badActor).setValidatorRatio(ethers.BigNumber.from(2), ethers.BigNumber.from(9))).to.be.reverted;
    });

    it("Should not allow to drop bridge validator consensus treshhold below 1", async function() {
        await expect(receiver.setValidatorRatio(ethers.BigNumber.from(1), ethers.BigNumber.from(20))).to.be.revertedWith("bridge validator consensus threshold must be >= 1");
    });

    it("Should allow to execute message if it has enough signatures", async function() {
        await receiver.setValidatorRatio(3, 9);
        await caller.sendTransaction({
            to: caller.address,
            value: ethers.utils.parseEther("0"),
        });

        const _data = testERC721Foreign.interface.encodeFunctionData("mint", [caller.address, tokenId]);
        const _hash = ethers.utils.solidityKeccak256(["address", "address", "bytes", "uint256", "uint256", "uint256", "uint256"], [caller.address, testERC721Foreign.address, _data, ethers.BigNumber.from(0), ethers.BigNumber.from(1), homeChainId, foreignChainId]);

        const domain = await getDomain(receiver.address);
        const message = {
            sender: caller.address,
            targetAddress: testERC721Foreign.address,
            data: _data,
            value: ethers.BigNumber.from(0),
            id: ethers.BigNumber.from(1),
            homeChainId: homeChainId,
            foreignChainId: foreignChainId,
            hash: _hash,
        };

        const signature1 = await validator1._signTypedData(domain, type, message);
        const signature2 = await validator2._signTypedData(domain, type, message);
        const signature3 = await validator3._signTypedData(domain, type, message);

        const tx = await receiver.connect(caller).executeMessage([signature1, signature2, signature3], message);
        await caller.sendTransaction({
            to: caller.address,
            value: ethers.utils.parseEther("0"),
        });

        const validatedMessage = await receiver.getMessage(ethers.BigNumber.from(1));

        expect(await testERC721Foreign.ownerOf(tokenId)).to.equal(caller.address);
        expect(await receiver.connect(caller).getExecutedMessage(ethers.BigNumber.from(1))).to.equal(true);

        expect(validatedMessage.validators).to.deep.equal([validator1.address, validator2.address, validator3.address]);
        expect(validatedMessage.sender).to.equal(caller.address);
        expect(validatedMessage.targetAddress).to.equal(testERC721Foreign.address);
        expect(validatedMessage.data).to.equal(_data);
        expect(validatedMessage.value).to.equal(ethers.BigNumber.from(0));
        expect(validatedMessage.homeChainId).to.equal(ethers.BigNumber.from(homeChainId));
        expect(validatedMessage.foreignChainId).to.equal(ethers.BigNumber.from(foreignChainId));

        await expect(tx).to.emit(receiver, "MessageExecuted").withArgs(
            [validator1.address, validator2.address, validator3.address],
            caller.address,
            testERC721Foreign.address,
            _data,
            ethers.BigNumber.from(0),
            ethers.BigNumber.from(1),
            ethers.BigNumber.from(homeChainId),
            ethers.BigNumber.from(foreignChainId),
            _hash
        );
    });

    it("Should allow to execute payable message with ETH", async function() {
        await receiver.setValidatorRatio(3, 9);
        await caller.sendTransaction({
            to: caller.address,
            value: ethers.utils.parseEther("0"),
        });

        const _data = testERC721Foreign.interface.encodeFunctionData("mintPayable", [caller.address, tokenId]);
        const _hash = ethers.utils.solidityKeccak256(["address", "address", "bytes", "uint256", "uint256", "uint256", "uint256"], [caller.address, testERC721Foreign.address, _data, ethers.utils.parseEther("2"), ethers.BigNumber.from(1), homeChainId, foreignChainId]);

        const domain = await getDomain(receiver.address);
        const message = {
            sender: caller.address,
            targetAddress: testERC721Foreign.address,
            data: _data,
            value: ethers.utils.parseEther("2"),
            id: ethers.BigNumber.from(1),
            homeChainId: homeChainId,
            foreignChainId: foreignChainId,
            hash: _hash,
        };

        const signature1 = await validator1._signTypedData(domain, type, message);
        const signature2 = await validator2._signTypedData(domain, type, message);
        const signature3 = await validator3._signTypedData(domain, type, message);

        const tx = await receiver.connect(caller).executeMessage([signature1, signature2, signature3], message, { value: ethers.utils.parseEther("2") });
        await caller.sendTransaction({
            to: caller.address,
            value: ethers.utils.parseEther("0"),
        });

        const validatedMessage = await receiver.getMessage(ethers.BigNumber.from(1));

        expect(await testERC721Foreign.ownerOf(tokenId)).to.equal(caller.address);
        expect(await receiver.connect(caller).executedMessages(ethers.BigNumber.from(1))).to.equal(true);
        
        expect(validatedMessage.validators).to.deep.equal([validator1.address, validator2.address, validator3.address]);
        expect(validatedMessage.sender).to.equal(caller.address);
        expect(validatedMessage.targetAddress).to.equal(testERC721Foreign.address);
        expect(validatedMessage.data).to.equal(_data);
        expect(validatedMessage.value).to.equal(ethers.utils.parseEther("2"));
        expect(validatedMessage.homeChainId).to.equal(ethers.BigNumber.from(homeChainId));
        expect(validatedMessage.foreignChainId).to.equal(ethers.BigNumber.from(foreignChainId));

        await expect(tx).to.emit(receiver, "MessageExecuted").withArgs(
            [validator1.address, validator2.address, validator3.address],
            caller.address,
            testERC721Foreign.address,
            _data,
            ethers.utils.parseEther("2"),
            ethers.BigNumber.from(1),
            ethers.BigNumber.from(homeChainId),
            ethers.BigNumber.from(foreignChainId),
            _hash
        );
    });

    it("Should not allow to execute non-payable message with ETH", async function() {
        await receiver.setValidatorRatio(3, 9);
        await caller.sendTransaction( {to: receiver.address, value: ethers.utils.parseEther("4") } );
        await caller.sendTransaction({
            to: caller.address,
            value: ethers.utils.parseEther("0"),
        });

        const _data = testERC721Foreign.interface.encodeFunctionData("mint", [caller.address, tokenId]);
        const _hash = ethers.utils.solidityKeccak256(["address", "address", "bytes", "uint256", "uint256", "uint256", "uint256"], [caller.address, testERC721Foreign.address, _data, ethers.utils.parseEther("2"), ethers.BigNumber.from(1), homeChainId, foreignChainId]);

        const domain = await getDomain(receiver.address);
        const message = {
            sender: caller.address,
            targetAddress: testERC721Foreign.address,
            data: _data,
            value: ethers.utils.parseEther("2"),
            id: ethers.BigNumber.from(1),
            homeChainId: homeChainId,
            foreignChainId: foreignChainId,
            hash: _hash,
        };

        const signature1 = await validator1._signTypedData(domain, type, message);
        const signature2 = await validator2._signTypedData(domain, type, message);
        const signature3 = await validator3._signTypedData(domain, type, message);

        await expect(receiver.connect(caller).executeMessage([signature1, signature2, signature3], message, {value: ethers.utils.parseEther("2")})).to.be.rejectedWith("call to target address failed");
    });

    it("Should not allow to execute message twice", async function() {
        await receiver.setValidatorRatio(3, 9);
        await caller.sendTransaction({
            to: caller.address,
            value: ethers.utils.parseEther("0"),
        });

        const _data = testERC721Foreign.interface.encodeFunctionData("mint", [caller.address, tokenId]);
        const _hash = ethers.utils.solidityKeccak256(["address", "address", "bytes", "uint256", "uint256", "uint256", "uint256"], [caller.address, testERC721Foreign.address, _data, ethers.BigNumber.from(0), ethers.BigNumber.from(1), homeChainId, foreignChainId]);

        const domain = await getDomain(receiver.address);
        const message = {
            sender: caller.address,
            targetAddress: testERC721Foreign.address,
            data: _data,
            value: ethers.BigNumber.from(0),
            id: ethers.BigNumber.from(1),
            homeChainId: homeChainId,
            foreignChainId: foreignChainId,
            hash: _hash,
        };

        const signature1 = await validator1._signTypedData(domain, type, message);
        const signature2 = await validator2._signTypedData(domain, type, message);
        const signature3 = await validator3._signTypedData(domain, type, message);

        await receiver.connect(caller).executeMessage([signature1, signature2, signature3], message);
        await caller.sendTransaction({
            to: caller.address,
            value: ethers.utils.parseEther("0"),
        });

        await expect(receiver.connect(caller).executeMessage([signature1, signature2, signature3], message)).to.be.revertedWith("Message already executed");
    });

    // it("Should not allow to non original sender to execute message", async function() {
    //     await receiver.setValidatorRatio(3, 9);
    //     await caller.sendTransaction({
    //         to: caller.address,
    //         value: ethers.utils.parseEther("0"),
    //     });

    //     const _data = testERC721Foreign.interface.encodeFunctionData("mint", [caller.address, tokenId]);
    //     const _hash = ethers.utils.solidityKeccak256(["address", "address", "bytes", "uint256", "uint256", "uint256", "uint256"], [caller.address, testERC721Foreign.address, _data, ethers.BigNumber.from(0), ethers.BigNumber.from(1), homeChainId, foreignChainId]);

    //     const domain = await getDomain(receiver.address);
    //     const message = {
    //         sender: caller.address,
    //         targetAddress: testERC721Foreign.address,
    //         data: _data,
    //         value: ethers.BigNumber.from(0),
    //         homeChainId: homeChainId,
    //         foreignChainId: foreignChainId,
    //         id: ethers.BigNumber.from(1),
    //         hash: _hash,
    //     };

    //     const signature1 = await validator1._signTypedData(domain, type, message);
    //     const signature2 = await validator2._signTypedData(domain, type, message);
    //     const signature3 = await validator3._signTypedData(domain, type, message);

    //     await expect(receiver.connect(badActor).executeMessage([signature1, signature2, signature3], message)).to.be.revertedWith("Only the original sender can execute the message. User addresses in different chains must be the same");
    // });

    it("Should not allow to execute message without enough signatures: Case #1 - not enough validators signed", async function() {
        await receiver.setValidatorRatio(1, 1);
        await caller.sendTransaction({
            to: caller.address,
            value: ethers.utils.parseEther("0"),
        });

        const _data = testERC721Foreign.interface.encodeFunctionData("mint", [caller.address, tokenId]);
        const _hash = ethers.utils.solidityKeccak256(["address", "address", "bytes", "uint256", "uint256", "uint256", "uint256"], [caller.address, testERC721Foreign.address, _data, ethers.BigNumber.from(0), ethers.BigNumber.from(1), homeChainId, foreignChainId]);

        const domain = await getDomain(receiver.address);
        const message = {
            sender: caller.address,
            targetAddress: testERC721Foreign.address,
            data: _data,
            value: ethers.BigNumber.from(0),
            homeChainId: homeChainId,
            foreignChainId: foreignChainId,
            id: ethers.BigNumber.from(1),
            hash: _hash,
        };

        const signature1 = await validator1._signTypedData(domain, type, message);
        const signature2 = await validator2._signTypedData(domain, type, message);
        const signature3 = await validator3._signTypedData(domain, type, message);

        await expect(receiver.connect(caller).executeMessage([signature1, signature2, signature3], message)).to.be.revertedWith("Not enough signatures");
    });

    it("Should not allow to execute message without enough signatures: Case #2 - some of signers are not validators", async function() {
        await receiver.setValidatorRatio(3, 9);
        await caller.sendTransaction({
            to: caller.address,
            value: ethers.utils.parseEther("0"),
        });

        const _data = testERC721Foreign.interface.encodeFunctionData("mint", [caller.address, tokenId]);
        const _hash = ethers.utils.solidityKeccak256(["address", "address", "bytes", "uint256", "uint256", "uint256", "uint256"], [caller.address, testERC721Foreign.address, _data, ethers.BigNumber.from(0), ethers.BigNumber.from(1), homeChainId, foreignChainId]);

        const domain = await getDomain(receiver.address);
        const message = {
            sender: caller.address,
            targetAddress: testERC721Foreign.address,
            data: _data,
            value: ethers.BigNumber.from(0),
            id: ethers.BigNumber.from(1),
            homeChainId: homeChainId,
            foreignChainId: foreignChainId,
            hash: _hash,
        };

        const signature1 = await badActor._signTypedData(domain, type, message);
        const signature2 = await validator2._signTypedData(domain, type, message);
        const signature3 = await validator3._signTypedData(domain, type, message);

        await expect(receiver.connect(caller).executeMessage([signature1, signature2, signature3], message)).to.be.revertedWith("Not enough signatures");
    });

    it("Should not allow to execute message without enough signatures: Case #3 - one validator signed multiple times", async function() {
        await receiver.setValidatorRatio(3, 9);
        await caller.sendTransaction({
            to: caller.address,
            value: ethers.utils.parseEther("0"),
        });

        const _data = testERC721Foreign.interface.encodeFunctionData("mint", [caller.address, tokenId]);
        const _hash = ethers.utils.solidityKeccak256(["address", "address", "bytes", "uint256", "uint256", "uint256", "uint256"], [caller.address, testERC721Foreign.address, _data, ethers.BigNumber.from(0), ethers.BigNumber.from(1), homeChainId, foreignChainId]);

        const domain = await getDomain(receiver.address);
        const message = {
            sender: caller.address,
            targetAddress: testERC721Foreign.address,
            data: _data,
            value: ethers.BigNumber.from(0),
            id: ethers.BigNumber.from(1),
            homeChainId: homeChainId,
            foreignChainId: foreignChainId,
            hash: _hash,
        };

        const signature1 = await validator1._signTypedData(domain, type, message);
        const signature2 = await validator1._signTypedData(domain, type, message);
        const signature3 = await validator1._signTypedData(domain, type, message);

        await expect(receiver.connect(caller).executeMessage([signature1, signature2, signature3], message)).to.be.revertedWith("Not enough signatures");
    });

    it("Should store the correct number of validators", async function() {
        await receiver.setValidatorRatio(3, 9);
        await caller.sendTransaction({
            to: caller.address,
            value: ethers.utils.parseEther("0"),
        });

        const _data = testERC721Foreign.interface.encodeFunctionData("mint", [caller.address, tokenId]);
        const _hash = ethers.utils.solidityKeccak256(["address", "address", "bytes", "uint256", "uint256", "uint256", "uint256"], [caller.address, testERC721Foreign.address, _data, ethers.BigNumber.from(0), ethers.BigNumber.from(1), homeChainId, foreignChainId]);

        const domain = await getDomain(receiver.address);
        const message = {
            sender: caller.address,
            targetAddress: testERC721Foreign.address,
            data: _data,
            value: ethers.BigNumber.from(0),
            id: ethers.BigNumber.from(1),
            homeChainId: homeChainId,
            foreignChainId: foreignChainId,
            hash: _hash,
        };

        const signature1 = await validator1._signTypedData(domain, type, message);
        const signature2 = await validator2._signTypedData(domain, type, message);
        const signature3 = await validator3._signTypedData(domain, type, message);
        const signature4 = await validator3._signTypedData(domain, type, message);
        const signature5 = await validator3._signTypedData(domain, type, message);

        await receiver.connect(caller).executeMessage([signature1, signature2, signature3, signature4, signature5], message);
        await caller.sendTransaction({
            to: caller.address,
            value: ethers.utils.parseEther("0"),
        });

        const validatedMessage = await receiver.getMessage(ethers.BigNumber.from(1));

        expect(validatedMessage.validators).to.deep.equal([validator1.address, validator2.address, validator3.address]);
        expect(await receiver.validators(validator1.address)).to.equal(false);
        expect(await receiver.validators(validator2.address)).to.equal(false);
        expect(await receiver.validators(validator3.address)).to.equal(false);
    })

    it("Should not allow to execute the message if the provided data is invalid", async function() {
        await receiver.setValidatorRatio(3, 9);
        await caller.sendTransaction({
            to: caller.address,
            value: ethers.utils.parseEther("0"),
        });

        const _data = ethers.utils.hexZeroPad(ethers.utils.hexlify(0), 32);
        const _hash = ethers.utils.solidityKeccak256(["address", "address", "bytes", "uint256", "uint256", "uint256", "uint256"], [caller.address, testERC721Foreign.address, _data, ethers.BigNumber.from(0), ethers.BigNumber.from(1), homeChainId, foreignChainId]);

        const domain = await getDomain(receiver.address);
        const message = {
            sender: caller.address,
            targetAddress: testERC721Foreign.address,
            data: _data,
            value: ethers.BigNumber.from(0),
            id: ethers.BigNumber.from(1),
            homeChainId: homeChainId,
            foreignChainId: foreignChainId,
            hash: _hash,
        };

        const signature1 = await validator1._signTypedData(domain, type, message);
        const signature2 = await validator2._signTypedData(domain, type, message);
        const signature3 = await validator3._signTypedData(domain, type, message);

        await expect(receiver.connect(caller).executeMessage([signature1, signature2, signature3], message)).to.be.reverted;
    });

    it("Should not allow to execute the message if the provided message is invalid: Case #1 - trying to transfer token that is already minted on the Foreign Chain", async function() {
        await receiver.setValidatorRatio(3, 9);
        await caller.sendTransaction({
            to: caller.address,
            value: ethers.utils.parseEther("0"),
        });

        await testERC721Foreign.mint(alice.address, tokenId);
        await caller.sendTransaction({
            to: caller.address,
            value: ethers.utils.parseEther("0"),
        });

        const _data = testERC721Foreign.interface.encodeFunctionData("mint", [caller.address, tokenId]);
        const _hash = ethers.utils.solidityKeccak256(["address", "address", "bytes", "uint256", "uint256", "uint256", "uint256"], [caller.address, testERC721Foreign.address, _data, ethers.BigNumber.from(0), ethers.BigNumber.from(1), homeChainId, foreignChainId]);

        const domain = await getDomain(receiver.address);
        const message = {
            sender: caller.address,
            targetAddress: testERC721Foreign.address,
            data: _data,
            value: ethers.BigNumber.from(0),
            id: ethers.BigNumber.from(1),
            homeChainId: homeChainId,
            foreignChainId: foreignChainId,
            hash: _hash,
        };

        const signature1 = await validator1._signTypedData(domain, type, message);
        const signature2 = await validator2._signTypedData(domain, type, message);
        const signature3 = await validator3._signTypedData(domain, type, message);

        await expect(receiver.connect(caller).executeMessage([signature1, signature2, signature3], message)).to.be.rejectedWith("call to target address failed");
    });

    it("Should not allow to execute the message if the provided message is invalid: Case #2 - caller contract has no provided function", async function() {
        await receiver.setValidatorRatio(3, 9);
        await caller.sendTransaction({
            to: caller.address,
            value: ethers.utils.parseEther("0"),
        });

        const _data = testERC20Foreign.interface.encodeFunctionData("increaseAllowance", [caller.address, tokenId]);
        const _hash = ethers.utils.solidityKeccak256(["address", "address", "bytes", "uint256", "uint256", "uint256", "uint256"], [caller.address, testERC721Foreign.address, _data, ethers.BigNumber.from(0), ethers.BigNumber.from(1), ethers.BigNumber.from(homeChainId), ethers.BigNumber.from(foreignChainId)]);

        const domain = await getDomain(receiver.address);
        const message = {
            sender: caller.address,
            targetAddress: testERC721Foreign.address,
            data: _data,
            value: ethers.BigNumber.from(0),
            id: ethers.BigNumber.from(1),
            homeChainId: homeChainId,
            foreignChainId: foreignChainId,
            hash: _hash,
        };

        const signature1 = await validator1._signTypedData(domain, type, message);
        const signature2 = await validator2._signTypedData(domain, type, message);
        const signature3 = await validator3._signTypedData(domain, type, message);

        await expect(receiver.connect(caller).callStatic.executeMessage([signature1, signature2, signature3], message)).to.be.rejectedWith("call to target address failed");
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
        receiver = await upgrades.deployProxy(Receiver, [validators, 5, 10], { initializer: 'initialize', kind: 'uups' });
        validatorRole = await receiver.VALIDATOR_ROLE();

        sender = await upgrades.deployProxy(Sender, { initializer: 'initialize', kind: 'uups' } );    

        testERC20Home = await TestERC20.deploy("Test token", "TSTKN");
        await testERC20Home.deployed();

        testERC20Foreign = await TestERC20.deploy("Test token", "TSTKN");
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
        await caller.sendTransaction({
            to: caller.address,
            value: ethers.utils.parseEther("0"),
        });

        await testERC20Home.connect(caller).approve(sender.address, feeAmount);
        await caller.sendTransaction({
            to: caller.address,
            value: ethers.utils.parseEther("0"),
        });

        const _data = testERC721Foreign.interface.encodeFunctionData("mint", [caller.address, tokenId]);
        const messageId = await sender.nextMessageId();
        const _hash = ethers.utils.solidityKeccak256(["address", "address", "bytes", "uint256", "uint256", "uint256", "uint256"], [caller.address, testERC721Foreign.address, _data, ethers.BigNumber.from(0), messageId, homeChainId, foreignChainId]);

        const txSender = await sender.connect(caller).sendMessage(testERC721Foreign.address, _data, 0, foreignChainId);
        await caller.sendTransaction({
            to: caller.address,
            value: ethers.utils.parseEther("0"),
        });

        const receipt = await txSender.wait();

        await expect(txSender).to.emit(sender, "RequestForSignature").withArgs(
            caller.address,
            testERC721Foreign.address,
            _data,
            ethers.BigNumber.from(0),
            messageId,
            ethers.BigNumber.from(homeChainId),
            ethers.BigNumber.from(foreignChainId),
            _hash
        );
        expect(await testERC20Home.balanceOf(feeReceiver.address)).to.equal(ethers.BigNumber.from(feeAmount));

        // Receiver part - Chain B
        const domain = await getDomain(receiver.address);
        const message = {
            sender: receipt.events[2].args.sender,
            targetAddress: receipt.events[2].args.targetAddress,
            data: receipt.events[2].args.data,
            value: receipt.events[2].args.value,
            id: messageId,
            homeChainId: receipt.events[2].args.homeChainId,
            foreignChainId: receipt.events[2].args.foreignChainId,
            hash: receipt.events[2].args.hash,
        };

        const signature1 = await validator1._signTypedData(domain, type, message);
        const signature2 = await validator2._signTypedData(domain, type, message);
        const signature3 = await validator3._signTypedData(domain, type, message);
        const signature4 = await validator4._signTypedData(domain, type, message);
        const signature5 = await validator5._signTypedData(domain, type, message);
        const signature6 = await validator6._signTypedData(domain, type, message);

        const txReceiver = await receiver.connect(caller).executeMessage([signature1, signature2, signature3, signature4, signature5, signature6], message);
        await caller.sendTransaction({
            to: caller.address,
            value: ethers.utils.parseEther("0"),
        });

        await expect(txReceiver).to.emit(receiver, "MessageExecuted").withArgs(
            [validator1.address, validator2.address, validator3.address, validator4.address, validator5.address, validator6.address],
            caller.address,
            testERC721Foreign.address,
            _data,
            ethers.BigNumber.from(0),
            messageId,
            ethers.BigNumber.from(homeChainId),
            ethers.BigNumber.from(foreignChainId),
            _hash
        );

        expect(await testERC721Foreign.ownerOf(tokenId)).to.equal(caller.address);
    });

    it("Should allow to transfer tokens only using information stored on-chain", async function() {
        // Sender paart - Chain A
        await testERC20Home.transfer(caller.address, feeAmount);
        await caller.sendTransaction({
            to: caller.address,
            value: ethers.utils.parseEther("0"),
        });

        await testERC20Home.connect(caller).approve(sender.address, feeAmount);
        await caller.sendTransaction({
            to: caller.address,
            value: ethers.utils.parseEther("0"),
        });

        const _data = testERC721Foreign.interface.encodeFunctionData("mint", [caller.address, tokenId]);
        const messageId = await sender.nextMessageId();
        const _hash = ethers.utils.solidityKeccak256(["address", "address", "bytes", "uint256", "uint256", "uint256", "uint256"], [caller.address, testERC721Foreign.address, _data, ethers.BigNumber.from(0), messageId, homeChainId, foreignChainId]);
        const txSender = await sender.connect(caller).sendMessage(testERC721Foreign.address, _data, ethers.BigNumber.from(0), foreignChainId);
        await caller.sendTransaction({
            to: caller.address,
            value: ethers.utils.parseEther("0"),
        });

        const messageFromSender = await sender.messages(messageId);

        await expect(txSender).to.emit(sender, "RequestForSignature").withArgs(
            caller.address,
            testERC721Foreign.address,
            _data,
            ethers.BigNumber.from(0),
            messageId,
            ethers.BigNumber.from(homeChainId),
            ethers.BigNumber.from(foreignChainId),
            _hash
        );
        expect(await testERC20Home.balanceOf(feeReceiver.address)).to.equal(ethers.BigNumber.from(feeAmount));

        // Receiver part - Chain B
        const domain = await getDomain(receiver.address);
        const message = {
            sender: messageFromSender.sender,
            targetAddress: messageFromSender.targetAddress,
            data: messageFromSender.data,
            value: messageFromSender.value,
            id: messageId,
            homeChainId: messageFromSender.homeChainId,
            foreignChainId: messageFromSender.foreignChainId,
            hash: _hash,
        };

        const signature1 = await validator1._signTypedData(domain, type, message);
        const signature2 = await validator2._signTypedData(domain, type, message);
        const signature3 = await validator3._signTypedData(domain, type, message);
        const signature4 = await validator4._signTypedData(domain, type, message);
        const signature5 = await validator5._signTypedData(domain, type, message);
        const signature6 = await validator6._signTypedData(domain, type, message);

        const txReceiver = await receiver.connect(caller).executeMessage([signature1, signature2, signature3, signature4, signature5, signature6], message);
        await caller.sendTransaction({
            to: caller.address,
            value: ethers.utils.parseEther("0"),
        });
        
        await expect(txReceiver).to.emit(receiver, "MessageExecuted").withArgs(
            [validator1.address, validator2.address, validator3.address, validator4.address, validator5.address, validator6.address],
            caller.address,
            testERC721Foreign.address,
            _data,
            ethers.BigNumber.from(0),
            messageId,
            ethers.BigNumber.from(homeChainId),
            ethers.BigNumber.from(foreignChainId),
            _hash
        );

        expect(await testERC721Foreign.ownerOf(tokenId)).to.equal(caller.address);
    });
});