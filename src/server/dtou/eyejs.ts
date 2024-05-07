import { readFileSync } from 'fs';
import { n3reasoner, SwiplEye, queryOnce } from 'eyereasoner';
import { join as path_join } from 'path';
import { getDerivedPolicyForPort } from './result_helper';

const langGeneral = readFileSync(path_join(__dirname, './assets/dtou-lang/dtou-lang-general.n3s')).toString();
const langReasoning = readFileSync(path_join(__dirname, './assets/dtou-lang/dtou-lang-reasoning.n3s')).toString();
const langReasoningConflict = readFileSync(path_join(__dirname, './assets/dtou-lang/dtou-lang2-reasoning-compliance.n3s')).toString();
const langReasoningObligation = readFileSync(path_join(__dirname, './assets/dtou-lang/dtou-lang2-reasoning-obligation.n3s')).toString();
const langReasoningDerivation = readFileSync(path_join(__dirname, './assets/dtou-lang/dtou-lang2-reasoning-derivation.n3s')).toString();
const lang = readFileSync(path_join(__dirname, './assets/dtou-lang/dtou-lang.n3s')).toString();
const queryConflict = readFileSync(path_join(__dirname, './assets/dtou-lang/dtou-query-conflict.n3s')).toString();
const queryObligation = readFileSync(path_join(__dirname, './assets/dtou-lang/dtou-query-obligation.n3s')).toString();
const queryDerived = readFileSync(path_join(__dirname, './assets/dtou-lang/dtou-query-derived.n3s')).toString();

const langReasoningBase3 = [
  readFileSync(path_join(__dirname, './assets/dtou-lang/dtou-lang3-reasoning-bare.n3s')).toString(),
  readFileSync(path_join(__dirname, './assets/dtou-lang/dtou-lang3-reasoning-conflict1.n3s')).toString(),
  readFileSync(path_join(__dirname, './assets/dtou-lang/dtou-lang3-reasoning-conflict2.n3s')).toString(),
  readFileSync(path_join(__dirname, './assets/dtou-lang/dtou-lang3-reasoning-conflict3.n3s')).toString(),
];

// /**
//  * All in one. Prefer the ones below for separated steps.
//  */
// export async function runDtouReasoning(sharedKnowledge: string, dataPolicy: string, appPolicy: string, usageContext: string) {
//   const dataString = [
//     langGeneral,
//     langReasoning,
//     lang,
//     sharedKnowledge,
//     dataPolicy,
//     appPolicy,
//     usageContext
//   ].join('\n');

//   const conflicts = await n3reasoner(dataString, queryConflict);
//   const activatedObligations = await n3reasoner(dataString, queryObligation);
//   const derivedPolicy = await n3reasoner(dataString, queryDerived);
//   return [conflicts, activatedObligations, derivedPolicy];
// }

export async function checkConflicts(dataPolicy: string, appPolicy: string, usageContext: string) {

  const dataString = [
    langGeneral,
    // langReasoning,
    langReasoningConflict,
    lang,
    dataPolicy,
    appPolicy,
    usageContext,
  ].join('\n');

  return await n3reasoner(dataString, queryConflict);
}

export async function checkObligations(dataPolicy: string, appPolicy: string, usageContext: string) {
  
  const dataString = [
    langGeneral,
    // langReasoning,
    langReasoningObligation,
    lang,
    dataPolicy,
    appPolicy,
    usageContext,
  ].join('\n');

  return await n3reasoner(dataString, queryObligation);
}

export async function derivePolicies(dataPolicy: string, appPolicy: string, usageContext: string, port?: string) {
  const dataString = [
    langGeneral,
    // langReasoning,
    langReasoningDerivation,
    lang,
    dataPolicy,
    appPolicy,
    usageContext,
  ].join('\n');

  const allDerivedPolicies = await n3reasoner(dataString, queryDerived);

  if (port) {
    const polByPort = await getDerivedPolicyForPort(allDerivedPolicies, port);
    return polByPort;
  }

  return allDerivedPolicies;
}

export async function runBase(dataPolicy: string, appPolicy: string, usageContext: string) {
  
  const dataString = [
    // langGeneral,
    // lang,
    dataPolicy,
    appPolicy,
    usageContext,
  ].join('\n');

  return await n3reasoner(dataString);
}

export async function runBase2(dataPolicy: string, appPolicy: string, usageContext: string) {
  
  const dataString = [
    langGeneral,
    lang,
    dataPolicy,
    appPolicy,
    usageContext,
  ].join('\n');

  return await n3reasoner(dataString);
}

export async function runBase3(index: number, dataPolicy: string, appPolicy: string, usageContext: string) {
  
  const dataString = [
    langGeneral,
    lang,
    langReasoningBase3[index],
    dataPolicy,
    appPolicy,
    usageContext,
  ].join('\n');

  return await n3reasoner(dataString);
}