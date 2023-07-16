const { ethers, upgrades } = require("hardhat");

async function main() {
    const Sender = await ethers.getContractFactory("Sender");
    
    const senderProxy = await upgrades.deployProxy(Sender, [], { initializer: 'initialize', kind: 'uups' });
    await senderProxy.deployed();
    const senderImplementation = await upgrades.erc1967.getImplementationAddress(senderProxy.address);

    console.log("Sender contract deployed to:", senderProxy.address);
    console.log("Sender contract implementation address:", senderImplementation);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});