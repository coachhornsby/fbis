import fs from 'node:fs/promises';
import {evaluateMlbFeaturePredictions} from '../functions/lib/mlbModelFeatures.js';
if(!process.argv[2])throw Error('Usage: node scripts/mlb-model-feature-evaluate.mjs paired-predictions.json');
console.log(JSON.stringify(evaluateMlbFeaturePredictions(JSON.parse(await fs.readFile(process.argv[2],'utf8'))),null,2));
