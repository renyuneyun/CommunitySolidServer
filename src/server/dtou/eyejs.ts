import { readFileSync } from 'fs';
import { n3reasoner, SwiplEye, queryOnce } from 'eyereasoner';
import { join as path_join } from 'path';
import { getDerivedPolicyForPort } from './result_helper';

const langGeneral = readFileSync(path_join(__dirname, './assets/dtou-lang-general.n3s')).toString();
const langReasoning = readFileSync(path_join(__dirname, './assets/dtou-lang-reasoning.n3s')).toString();
const lang = readFileSync(path_join(__dirname, './assets/dtou-lang.n3s')).toString();
const queryConflict = readFileSync(path_join(__dirname, './assets/dtou-query-conflict.n3s')).toString();
const queryObligation = readFileSync(path_join(__dirname, './assets/dtou-query-obligation.n3s')).toString();
const queryDerived = readFileSync(path_join(__dirname, './assets/dtou-query-derived.n3s')).toString();

/**
 * All in one. Prefer the ones below for separated steps.
 */
export async function runDtouReasoning(sharedKnowledge: string, dataPolicy: string, appPolicy: string, usageContext: string) {
  const dataString = [
    langGeneral,
    langReasoning,
    lang,
    sharedKnowledge,
    dataPolicy,
    appPolicy,
    usageContext
  ].join('\n');

  const conflicts = await n3reasoner(dataString, queryConflict);
  const activatedObligations = await n3reasoner(dataString, queryObligation);
  const derivedPolicy = await n3reasoner(dataString, queryDerived);
  return [conflicts, activatedObligations, derivedPolicy];
}

export async function checkConflicts(sharedKnowledge: string, dataPolicy: string, appPolicy: string, usageContext: string) {

  const dataString = [
    langGeneral,
    langReasoning,
    lang,
    sharedKnowledge,
    dataPolicy,
    appPolicy,
    usageContext,
  ].join('\n');

  return await n3reasoner(dataString, queryConflict);
}

export async function checkObligations(sharedKnowledge: string, dataPolicy: string, appPolicy: string, usageContext: string) {
  
  const dataString = [
    langGeneral,
    langReasoning,
    lang,
    sharedKnowledge,
    dataPolicy,
    appPolicy,
    usageContext,
  ].join('\n');

  return await n3reasoner(dataString, queryObligation);
}

export async function derivePolicies(sharedKnowledge: string, dataPolicy: string, appPolicy: string, usageContext: string, port?: string) {
  const dataString = [
    langGeneral,
    langReasoning,
    lang,
    sharedKnowledge,
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
