import { Store, Parser, Writer, BlankNode, DataFactory, NamedNode, Quad } from 'n3';
// import { DataFactory } from 'n3';
import namespace from '@rdfjs/namespace'
import { QueryEngine, QueryEngineFactory } from '@comunica/query-sparql';

const IRI_DTOU = 'http://example.org/ns#';
const IRI_XSD = 'http://www.w3.org/2001/XMLSchema#';

const RDF = namespace('http://www.w3.org/1999/02/22-rdf-syntax-ns#');
const DTOU = namespace(IRI_DTOU);
const P_A = RDF('type');
const C_INPUTSPEC = DTOU('InputSpec');
const C_APPPOLICY = DTOU('AppPolicy');
const C_PORT = DTOU('Port');
const P_DATA = DTOU('data');
const P_OUTPUTSPEC = DTOU('output_spec');
const P_PORT = DTOU('port');
const P_NAME = DTOU('name');

const myEngine = new QueryEngine();

const PREFIXES = `
PREFIX dtou: <http://example.org/ns#>
`;

export interface UsageContext {
  time: Date;
  user?: string;
  appPolicyNode: string;
}

export function rdfToStore(rdfDoc: string): Store {
  const parser = new Parser();
  const store = new Store();
  store.addQuads(parser.parse(rdfDoc));
  return store;
}

async function query(rdfDoc: string, query: string) {
  return (await myEngine.queryBindings(
    `${PREFIXES}\n${query}`,
    {
      sources: [ rdfToStore(rdfDoc) ],
    },
  )).toArray();
}

export async function extractDataUrlFromAppPolicy(appPolicy: string) {
  const store = rdfToStore(appPolicy);
  const dataUrls = [] as string[];
  // for (const s of store.getSubjects(P_A, C_INPUTSPEC)) {
  //     dataUrls.push(...store.getObjects(s, P_DATA).map(o => o.id));
  // }
  for (const binding of await query(appPolicy, `
    SELECT ?s WHERE {
        ?s a dtou:InputSpec.
    }
    `)) {
    const sub = binding.get('s')!.value;
    for (const binding2 of await query(appPolicy, `
        SELECT ?o WHERE {
            <${sub}> dtou:data ?o.
        }
        `)) {
      const [ obj ] = [ 'o' ].map((val): string => binding2.get(val)!.value);
      dataUrls.push(obj);
    }
  }
  return dataUrls;
}

export async function extractOutputPortsFromAppPolicy(appPolicy: string): Promise<string[]> {
  const outputPorts = [] as string[];
  for (const binding of await query(appPolicy, `
    SELECT ?n WHERE {
        ?p a dtou:AppPolicy;
            dtou:output_spec ?output_spec.
        ?output_spec dtou:port ?port.
        ?port dtou:name ?n.
    }
    `)) {
    const [ name ] = [ 'n' ].map((val): string => binding.get(val)!.value);
    outputPorts.push(name);
  }
  return outputPorts;
}

export async function extractAppPolicyNode(appPolicy: string): Promise<string> {
  const parser = new Parser();
  for (const quad of parser.parse(appPolicy)) {
    if (quad.predicate.equals(P_A) && quad.object.equals(DTOU['AppPolicy'])) {
      return quad.subject.value;
    }
  }
  throw new Error('No policy node in Application Policy');
}

export function getDtouUrl(dataUrl: string): string {
  return `${dataUrl}.dtou`;
}

export async function getDtou(dataUrls: string[]): Promise<string[]> {
  return await Promise.all(
    dataUrls.map(
      async(url): Promise<string> =>
        fetch(getDtouUrl(url)).then(
          async(res): Promise<string> => await res.text()
        )
    )
  );
}

export async function contextToPol(context: UsageContext): Promise<string> {
  const writer = new Writer({
    prefixes: {
      'xsd': IRI_XSD,
      '': IRI_DTOU,
    },
  });

  const nodeUsageContext = new NamedNode('urn:dtou:server#usage1');
  const nodeApp = new BlankNode('app');

  writer.addQuad(DataFactory.quad(nodeUsageContext, P_A, DTOU['UsageContext']));
  if (context.user) {
    writer.addQuad(DataFactory.quad(nodeUsageContext, DTOU['user'], DataFactory.literal(context.user)));
  }
  writer.addQuad(DataFactory.quad(nodeUsageContext, DTOU['app'], nodeApp));
  writer.addQuad(
    DataFactory.quad(
      nodeUsageContext,
      DTOU['time'],
      DataFactory.literal(context.time.toISOString(), DataFactory.namedNode('xsd:dateTime')),
    )
  );
  writer.addQuad(DataFactory.quad(nodeApp, P_A, DTOU['AppInfo']));
  writer.addQuad(DataFactory.quad(nodeApp, DTOU['policy'], DataFactory.namedNode(context.appPolicyNode)));

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