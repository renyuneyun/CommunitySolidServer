import namespace from '@rdfjs/namespace';
import N3 from 'n3';
// Import { DataFactory } from 'n3';

const IRI_DTOU = 'http://example.org/ns#';

const RDF = namespace('http://www.w3.org/1999/02/22-rdf-syntax-ns#');
const DTOU = namespace(IRI_DTOU);
const P_A = RDF('type');
const C_CONFLICT = DTOU('Conflict');
const P_PORT = DTOU('port');

export async function structureDerivedPoliciesByPorts(derivedPolicy: string) {
  const parser = new N3.Parser();
  const store = new N3.Store();
  store.addQuads(parser.parse(derivedPolicy));
  const policyMap = new Map();
  // @ts-expect-error
  for (const quad of store.getQuads(undefined, P_PORT)) {
    const port = quad.object.value; // FIXME: Use the port name, not the URI
    // @ts-expect-error
    const portName = store.getObjects(port, DTOU.name)[0].value;
    const s = quad.subject;
    // @ts-expect-error
    const quads = store.getQuads(s);
    let existing = policyMap.get(portName);
    if (!existing) {
      existing = [];
    }
    existing.push(...quads);
    policyMap.set(portName, existing);
  }
  return policyMap;
}

export async function getDerivedPolicyForPort(derivedPolicy: string, port: string): Promise<string> {
  const policyMap = await structureDerivedPoliciesByPorts(derivedPolicy);
  const writer = new N3.Writer({
    prefixes: {
      '': IRI_DTOU,
    },
  });
  writer.addQuads(policyMap.get(port));
  const getResultAsString = (): Promise<string> => new Promise((resolve, reject) => {
    writer.end((error: any, result: string) => {
      if (error) {
        reject(error);
      }
      resolve(result);
    });
  });
  return await getResultAsString();
}
