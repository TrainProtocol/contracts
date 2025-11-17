import * as fs from 'fs';
import * as path from 'path';
import { Train } from "../build/train/tact_Train";
import { prepareTactDeployment } from "@tact-lang/deployer";

async function deployContract() {
    let testnet = true; 
    let packageName = 'tact_Train.pkg';
    let outputPath = path.resolve(__dirname, '../build/train'); 
    let init = await Train.init();

    let data = init.data.toBoc(); 
    let pkg = fs.readFileSync(path.resolve(outputPath, packageName)); 

    let link = await prepareTactDeployment({ pkg, data, testnet });

    console.log('Deploy link: ' + link);
}

deployContract().catch(err => {
    console.error('Failed to deploy contract:', err);
});

