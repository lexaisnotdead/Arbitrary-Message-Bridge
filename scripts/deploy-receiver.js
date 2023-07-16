const { ethers, upgrades } = require("hardhat");
const inits = require("../state.json");

async function main() {
    const Receiver = await ethers.getContractFactory("Receiver");
    
    const receiverProxy = await upgrades.deployProxy(Receiver, [inits.VALIDATORS, inits.REQUIRED_SIGNATURES], { initializer: 'initialize', kind: 'uups' });
    await receiverProxy.deployed();
    const receiverImplementation = await upgrades.erc1967.getImplementationAddress(receiverProxy.address);

    console.log("Receiver contract deployed to:", receiverProxy.address);
    console.log("Receiver contract implementation address:", receiverImplementation);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});