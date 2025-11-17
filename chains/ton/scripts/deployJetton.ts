import * as fs from 'fs';
import * as path from 'path';
import { TrainJetton as Train } from '../build/jetton_train/tact_TrainJetton';
import { prepareTactDeployment } from '@tact-lang/deployer';

async function run() {
    let testnet = true; 
    let packageName = 'tact_TrainJetton.pkg';
    let outputPath = path.resolve(__dirname, '../build/jetton_train'); 
    let init = await Train.init();

    let data = init.data.toBoc(); 
    let pkg = fs.readFileSync(path.resolve(outputPath, packageName)); 

    let link = await prepareTactDeployment({ pkg, data, testnet });

    console.log('Deploy link: ' + link);
}

run().catch(err => {
    console.error('Failed to deploy contract:', err);
});