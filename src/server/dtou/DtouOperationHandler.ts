import { readFileSync } from 'fs';
import { join as path_join } from 'path';
import { Readable } from 'stream';
import type { Credentials } from '../../authentication/Credentials';
import type { CredentialsExtractor } from '../../authentication/CredentialsExtractor';
import type { Operation } from '../../http/Operation';
import { ResponseDescription } from '../../http/output/response/ResponseDescription';
import { BasicRepresentation } from '../../http/representation/BasicRepresentation';
import type { Representation } from '../../http/representation/Representation';
import type { ResourceIdentifier } from '../../http/representation/ResourceIdentifier';
import { getLoggerFor } from '../../logging/LogUtil';
import type { ResourceStore } from '../../storage/ResourceStore';
import { NotImplementedHttpError } from '../../util/errors/NotImplementedHttpError';
import { guardStream } from '../../util/GuardedStream';
import { readableToString } from '../../util/StreamUtil';
import type { OperationHttpHandlerInput } from '../OperationHttpHandler';
import {
  OperationHttpHandler,
} from '../OperationHttpHandler';
import { checkConflicts, checkObligations, derivePolicies, runBase, runBase2, runBase3 } from './eyejs';
import {
  extractDataUrlFromAppPolicy,
  getDtouUrl,
  extractOutputPortsFromAppPolicy,
  extractAppPolicyNode,
  contextToPol,
} from './helper';

const MSG_IMPOSSIBLE_ROUTER = 'Illegal state. The router should be able to handle but no handler was called.';
const MSG_APP_NOT_REGISTERED = 'App not registered but wanting to derive DToU';
const MSG_400_NO_PORT = 'Port is expected';

const R_PORT = /\/dtou\/[^/]+\/([^/]*)/u;

function bodyToDToU(body: string): string {
  const obj = JSON.parse(body) as CheckComplianceRequestData;
  const appPolicy = obj.policy;
  return appPolicy;
}

function bodyToBenchmarkPre(body: string) {
  const obj = JSON.parse(body) as BenchmarkPreRequestData
  return obj;
}

interface CheckComplianceRequestData {
  policy: string;
}

type BenchmarkPreRequestData = {
  url: string;
  policy: string;
}[];

interface DerivePolicyPostRequestData {
  url: string | string[];
}

interface AppPolicyInfo {
  policy: string;
  policyNode: Promise<string>;
  dataUrls: Promise<string[]>;
  outputPorts: Promise<string[]>;
}

type AppId = string;

/**
 * Handles DToU {@link Operation}s.
 *
 * === Old doc ===
 * Calls the getRepresentation function from a {@link ResourceStore}.
 */
export class DtouOperationHandler extends OperationHttpHandler {
  private readonly logger = getLoggerFor(this);

  private readonly credentialsExtractor: CredentialsExtractor;
  private readonly store: ResourceStore;

  private readonly baseUrl: string = 'http://localhost:3000';

  private static readonly paths: [string, string[], (operation: Operation, credentials: Credentials) => Promise<ResponseDescription>][] = [
    [ '/dtou', [ 'POST' ], DtouOperationHandler.prototype.handleRegister ],
    [ '/dtou/compliance', [ 'GET' ], DtouOperationHandler.prototype.handleCheckCompliance ],
    [ '/dtou/activated-obligations', [ 'GET' ], DtouOperationHandler.prototype.handleActivatedObligations ],
    [ '/dtou/benchmark/pre', [ 'POST' ], DtouOperationHandler.prototype.handleBenchmarkPre ],
    [ '/dtou/benchmark/base', [ 'GET' ], DtouOperationHandler.prototype.handleBenchmarkBase ],
    [ '/dtou/benchmark/base2', [ 'GET' ], DtouOperationHandler.prototype.handleBenchmarkBase2 ],
    [ '/dtou/benchmark/base3', [ 'GET' ], DtouOperationHandler.prototype.handleBenchmarkBase3 ],
    [ '/dtou/benchmark/base4', [ 'GET' ], DtouOperationHandler.prototype.handleBenchmarkBase4 ],
    [ '/dtou/benchmark/base5', [ 'GET' ], DtouOperationHandler.prototype.handleBenchmarkBase5 ],
    [ '/dtou/benchmark/base6', [ 'GET' ], DtouOperationHandler.prototype.handleBenchmarkBase6 ],
  ];

  private static readonly pathMatchers: [RegExp, string[], (operation: Operation, credentials: Credentials) => Promise<ResponseDescription>][] = [
    [ /^\/dtou\/derived-policies(\/.*)?$/u, [ 'GET', 'POST' ], DtouOperationHandler.prototype.handleDerivedPolicies ],
  ];

  // Private static readonly langGeneral = readFileSync(
  //   'assets/dtou-lang-general.n3s'
  // ).toString();
  // private static readonly langReasoning = readFileSync(
  //   'assets/reasoning/dtou-lang-reasoning.n3s'
  // ).toString();
  // private static readonly lang = readFileSync(
  //   'assets/reasoning/dtou-lang.n3s'
  // ).toString();
  // private static readonly queryConflict = readFileSync(
  //   'assets/reasoning/dtou-query-conflict.n3s'
  // ).toString();
  // private static readonly queryObligation = readFileSync(
  //   'assets/reasoning/dtou-query-obligation.n3s'
  // ).toString();
  // private static readonly queryDerived = readFileSync(
  //   'assets/reasoning/dtou-query-derived.n3s'
  // ).toString();

  private readonly cachedAppPolicies = new Map<AppId, AppPolicyInfo>();

  public constructor(
    credentialsExtractor: CredentialsExtractor,
    store: ResourceStore,
  ) {
    super();
    this.credentialsExtractor = credentialsExtractor;
    this.store = store;
  }

  public async canHandle({
    operation,
  }: OperationHttpHandlerInput): Promise<void> {
    const path = operation.target.path.slice(this.baseUrl.length);
    if (
      !(
        DtouOperationHandler.paths.some(
          ([ aPath, methods ]): boolean =>
            aPath === path && methods.includes(operation.method),
        ) ||
          DtouOperationHandler.pathMatchers.some(
            ([ matcher, methods ]): boolean =>
              matcher.test(path) && methods.includes(operation.method),
          )
      )
    ) {
      throw new NotImplementedHttpError(
        'This handler only supports operations for DToU',
      );
    }
    this.logger.info('DtouOperationHandler can handle.');
  }

  public async handle({
    operation,
    request,
    response,
  }: OperationHttpHandlerInput): Promise<ResponseDescription> {
    try {
      const path = operation.target.path.slice(this.baseUrl.length);
      this.logger.verbose(path);

      const credentials = await this.credentialsExtractor.handleSafe(request);
      this.logger.info(`Credentials: ${JSON.stringify(credentials)}`);

      for (const [ aPath, , method ] of DtouOperationHandler.paths) {
        if (path === aPath) {
          this.logger.info(`Match found: ${aPath} ${path}`);
          return await method.call(this, operation, credentials);
        }
      }
      for (const [ matcher, , method ] of DtouOperationHandler.pathMatchers) {
        if (matcher.test(path)) {
          this.logger.info(`Match found: ${matcher} ${path}`);
          return await method.call(this, operation, credentials);
        }
      }
    } catch (err: unknown) {  // Not executed. Why? Matters for production, but not for evaluation
      let msg: string;
      if (typeof err === 'string') {
        msg = err;
      } else if (err instanceof Error) {
        msg = err.message;
      } else {
        msg = 'Unknown error';
      }
      return new ResponseDescription(500, undefined, guardStream(Readable.from(msg)));
    }

    return new ResponseDescription(500, undefined, guardStream(Readable.from([ MSG_IMPOSSIBLE_ROUTER ])));
  }

  private async handleRegister(
    operation: Operation,
    credentials: Credentials,
  ): Promise<ResponseDescription> {
    this.logger.info('handleRegister');
    // FIXME: Remove handling "empty" apps. Needs to think how to deal with them -- maybe just ignore them and reject? Or do not cache but always require appPolicy with request?
    const appId = credentials.client?.clientId ?? '';

    const body = await readableToString(operation.body.data);
    const appPolicy = bodyToDToU(body);

    const policyNode = extractAppPolicyNode(appPolicy);
    const dataUrlsP = extractDataUrlFromAppPolicy(appPolicy);
    const outputPortsP = extractOutputPortsFromAppPolicy(appPolicy);

    const appPolicyInfo = {
      policy: appPolicy,
      policyNode,
      dataUrls: dataUrlsP,
      outputPorts: outputPortsP,
    };

    this.cachedAppPolicies.set(appId, appPolicyInfo);

    return new ResponseDescription(
      200,
    );
  }

  private async _preHandle(
    operation: Operation,
    credentials: Credentials,
  ): Promise<[AppPolicyInfo, string, string] | undefined> {
    const appId = credentials.client?.clientId ?? '';
    const appPolicyInfo = this.cachedAppPolicies.get(appId);
    if (!appPolicyInfo) {
      return undefined;
    }

    const dataUrls = await appPolicyInfo.dataUrls;
    const dtouList = await Promise.all(
      dataUrls.map(
        async(dataUrl): Promise<string> =>
          await readableToString(
            (
              await this.store.getRepresentation(
                { path: getDtouUrl(dataUrl) },
                {},
              )
            ).data,
          ),
      ),
    );
    const dtouString = dtouList.join('\n');

    const context = {
      time: new Date(),
      user: credentials.agent?.webId,
      appPolicyNode: await appPolicyInfo.policyNode,
    };
    const contextString = await contextToPol(context);

    return [ appPolicyInfo, dtouString, contextString ];
  }

  private async handleCheckCompliance(
    operation: Operation,
    credentials: Credentials,
  ): Promise<ResponseDescription> {
    this.logger.info('handleCheckCompliance');

    const res = await this._preHandle(operation, credentials);
    if (!res) {
      return new ResponseDescription(411,
        undefined,
        guardStream(Readable.from([ MSG_APP_NOT_REGISTERED ])));
    }
    const [ appPolicyInfo, dtouString, contextString ] = res;

    const conflict = await checkConflicts(
      dtouString,
      appPolicyInfo.policy,
      contextString,
    );
    return new ResponseDescription(
      200,
      undefined,
      guardStream(Readable.from([ conflict ])),
    );
  }

  private async handleActivatedObligations(
    operation: Operation,
    credentials: Credentials,
  ): Promise<ResponseDescription> {
    this.logger.info('handleActivatedObligations');

    const res = await this._preHandle(operation, credentials);
    if (!res) {
      return new ResponseDescription(401,
        undefined,
        guardStream(Readable.from([ MSG_APP_NOT_REGISTERED ])));
    }
    const [ appPolicyInfo, dtouString, contextString ] = res;

    const conflict = await checkObligations(
      dtouString,
      appPolicyInfo.policy,
      contextString,
    );
    return new ResponseDescription(
      200,
      undefined,
      guardStream(Readable.from([ conflict ])),
    );
  }

  private async handleDerivedPolicies(
    operation: Operation,
    credentials: Credentials,
  ): Promise<ResponseDescription> {
    this.logger.info('handleDerivedPolicies');

    const path = operation.target.path.slice(this.baseUrl.length);
    const port = R_PORT.exec(path)?.[1];
    this.logger.info(`Getting for port: <${port}>`);

    const res = await this._preHandle(operation, credentials);
    if (!res) {
      return new ResponseDescription(401,
        undefined,
        guardStream(Readable.from([ MSG_APP_NOT_REGISTERED ])));
    }
    const [ appPolicyInfo, dtouString, contextString ] = res;

    const derivedPolicies = await derivePolicies(
      dtouString,
      appPolicyInfo.policy,
      contextString,
      port,
    );

    if (operation.method === 'POST') {
      if (!port) {
        return new ResponseDescription(400, undefined, guardStream(Readable.from([ MSG_400_NO_PORT ])));
      }
      const body = await readableToString(operation.body.data);
      const requestData = JSON.parse(body) as DerivePolicyPostRequestData;
      const outputUrls = Array.isArray(requestData.url) ? requestData.url : [ requestData.url ];
      for (const url of outputUrls) {
        const dataDtouResourceIdentifier: ResourceIdentifier = { path: getDtouUrl(url) };
        const dataDtouRepresentation: Representation = new BasicRepresentation(derivedPolicies, 'text/turtle');
        await this.store.setRepresentation(dataDtouResourceIdentifier, dataDtouRepresentation);
      }
    }

    return new ResponseDescription(
      200,
      undefined,
      guardStream(Readable.from([ derivedPolicies ])),
    );
  }

  private async handleBenchmarkPre(
    operation: Operation,
    credentials: Credentials,
  ): Promise<ResponseDescription> {
    this.logger.info('handleBenchmarkPre');

    const body = await readableToString(operation.body.data);
    const parsedBody = bodyToBenchmarkPre(body);

    for (const dataDesc of parsedBody) {
      const dataResourceIdentifier: ResourceIdentifier = { path: dataDesc.url };
      const dataRepresentation: Representation = new BasicRepresentation();
      await this.store.setRepresentation(dataResourceIdentifier, dataRepresentation);

      const dataDtouResourceIdentifier: ResourceIdentifier = { path: getDtouUrl(dataDesc.url) };
      const dataDtouRepresentation: Representation = new BasicRepresentation(dataDesc.policy, 'text/turtle');
      await this.store.setRepresentation(dataDtouResourceIdentifier, dataDtouRepresentation);
    }

    return new ResponseDescription(
      200,
    );
  }

  private async handleBenchmarkBase(
    operation: Operation,
    credentials: Credentials,
  ): Promise<ResponseDescription> {
    this.logger.info('handleBenchmarkBase');

    const res = await this._preHandle(operation, credentials);
    if (!res) {
      return new ResponseDescription(401,
        undefined,
        guardStream(Readable.from([ MSG_APP_NOT_REGISTERED ])));
    }
    const [ appPolicyInfo, dtouString, contextString ] = res;

    const conflict = await runBase(
      dtouString,
      appPolicyInfo.policy,
      contextString,
    );
    return new ResponseDescription(
      200,
      undefined,
      guardStream(Readable.from([ conflict ])),
    );
  }

  private async handleBenchmarkBase2(
    operation: Operation,
    credentials: Credentials,
  ): Promise<ResponseDescription> {
    this.logger.info('handleBenchmarkBase2');

    const res = await this._preHandle(operation, credentials);
    if (!res) {
      return new ResponseDescription(401,
        undefined,
        guardStream(Readable.from([ MSG_APP_NOT_REGISTERED ])));
    }
    const [ appPolicyInfo, dtouString, contextString ] = res;

    const conflict = await runBase2(
      dtouString,
      appPolicyInfo.policy,
      contextString,
    );
    return new ResponseDescription(
      200,
      undefined,
      guardStream(Readable.from([ conflict ])),
    );
  }

  private async handleBenchmarkBase3(
    operation: Operation,
    credentials: Credentials,
  ): Promise<ResponseDescription> {
    this.logger.info('handleBenchmarkBase3');

    const res = await this._preHandle(operation, credentials);
    if (!res) {
      return new ResponseDescription(401,
        undefined,
        guardStream(Readable.from([ MSG_APP_NOT_REGISTERED ])));
    }
    const [ appPolicyInfo, dtouString, contextString ] = res;

    const conflict = await runBase3(
      0,
      dtouString,
      appPolicyInfo.policy,
      contextString,
    );
    return new ResponseDescription(
      200,
      undefined,
      guardStream(Readable.from([ conflict ])),
    );
  }

  private async handleBenchmarkBase4(
    operation: Operation,
    credentials: Credentials,
  ): Promise<ResponseDescription> {
    this.logger.info('handleBenchmarkBase4');

    const res = await this._preHandle(operation, credentials);
    if (!res) {
      return new ResponseDescription(401,
        undefined,
        guardStream(Readable.from([ MSG_APP_NOT_REGISTERED ])));
    }
    const [ appPolicyInfo, dtouString, contextString ] = res;

    const conflict = await runBase3(
      1,
      dtouString,
      appPolicyInfo.policy,
      contextString,
    );
    return new ResponseDescription(
      200,
      undefined,
      guardStream(Readable.from([ conflict ])),
    );
  }

  private async handleBenchmarkBase5(
    operation: Operation,
    credentials: Credentials,
  ): Promise<ResponseDescription> {
    this.logger.info('handleBenchmarkBase5');

    const res = await this._preHandle(operation, credentials);
    if (!res) {
      return new ResponseDescription(401,
        undefined,
        guardStream(Readable.from([ MSG_APP_NOT_REGISTERED ])));
    }
    const [ appPolicyInfo, dtouString, contextString ] = res;

    const conflict = await runBase3(
      2,
      dtouString,
      appPolicyInfo.policy,
      contextString,
    );
    return new ResponseDescription(
      200,
      undefined,
      guardStream(Readable.from([ conflict ])),
    );
  }

  private async handleBenchmarkBase6(
    operation: Operation,
    credentials: Credentials,
  ): Promise<ResponseDescription> {
    this.logger.info('handleBenchmarkBase6');

    const res = await this._preHandle(operation, credentials);
    if (!res) {
      return new ResponseDescription(401,
        undefined,
        guardStream(Readable.from([ MSG_APP_NOT_REGISTERED ])));
    }
    const [ appPolicyInfo, dtouString, contextString ] = res;

    const conflict = await runBase3(
      3,
      dtouString,
      appPolicyInfo.policy,
      contextString,
    );
    return new ResponseDescription(
      200,
      undefined,
      guardStream(Readable.from([ conflict ])),
    );
  }
}
