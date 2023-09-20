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
import { checkConflicts, checkObligations, derivePolicies } from './eyejs';
import {
  extractDataUrlFromAppPolicy,
  getDtouUrl,
  extractOutputPortsFromAppPolicy,
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

interface CheckComplianceRequestData {
  policy: string;
}

interface DerivePolicyPostRequestData {
  url: string | string[];
}

const testPolicyShared = readFileSync(path_join(__dirname, './assets/dtou-policy-shared.n3s')).toString();
const testPolicyUsageContext = readFileSync(path_join(__dirname, './assets/dtou-policy-usage1.n3s')).toString();

interface AppPolicyInfo {
  policy: string;
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

    const dataUrlsP = extractDataUrlFromAppPolicy(appPolicy);
    const outputPortsP = extractOutputPortsFromAppPolicy(appPolicy);

    const appPolicyInfo = {
      policy: appPolicy,
      dataUrls: dataUrlsP,
      outputPorts: outputPortsP,
    };

    this.cachedAppPolicies.set(appId, appPolicyInfo);

    return new ResponseDescription(
      200,
    );
  }

  private async handleCheckCompliance(
    operation: Operation,
    credentials: Credentials,
  ): Promise<ResponseDescription> {
    this.logger.info('handleCheckCompliance');
    const appId = credentials.client?.clientId ?? '';
    const appPolicyInfo = this.cachedAppPolicies.get(appId);
    if (!appPolicyInfo) {
      return new ResponseDescription(411,
        undefined,
        guardStream(Readable.from([ MSG_APP_NOT_REGISTERED ])));
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
    const conflict = await checkConflicts(
      testPolicyShared,
      dtouString,
      appPolicyInfo.policy,
      testPolicyUsageContext,
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
    const appId = credentials.client?.clientId ?? '';
    const appPolicyInfo = this.cachedAppPolicies.get(appId);
    if (!appPolicyInfo) {
      return new ResponseDescription(401,
        undefined,
        guardStream(Readable.from([ MSG_APP_NOT_REGISTERED ])));
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
    const conflict = await checkObligations(
      testPolicyShared,
      dtouString,
      appPolicyInfo.policy,
      testPolicyUsageContext,
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

    const appId = credentials.client?.clientId ?? '';
    const appPolicyInfo = this.cachedAppPolicies.get(appId);
    if (!appPolicyInfo) {
      return new ResponseDescription(401,
        undefined,
        guardStream(Readable.from([ MSG_APP_NOT_REGISTERED ])));
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
    const derivedPolicies = await derivePolicies(
      testPolicyShared,
      dtouString,
      appPolicyInfo.policy,
      testPolicyUsageContext,
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
}
