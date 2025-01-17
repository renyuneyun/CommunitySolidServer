import { CredentialsExtractor } from '../../authentication/CredentialsExtractor';
import type { RequestParser } from '../../http/input/RequestParser';
import type { ErrorHandler } from '../../http/output/error/ErrorHandler';
import type { ResponseDescription } from '../../http/output/response/ResponseDescription';
import type { ResponseWriter } from '../../http/output/ResponseWriter';
import { getLoggerFor } from '../../logging/LogUtil';
import { assertError } from '../../util/errors/ErrorUtil';
import { HttpError } from '../../util/errors/HttpError';
import type { HttpHandlerInput } from '../HttpHandler';
import { HttpHandler } from '../HttpHandler';
import type { HttpRequest } from '../HttpRequest';
import type { HttpResponse } from '../HttpResponse';
import type { OperationHttpHandler } from '../OperationHttpHandler';

export interface DtouHandlerArgs {
  /**
   * Extracts the credentials from the incoming request.
   */
  credentialsExtractor: CredentialsExtractor;
  /**
     * Parses the incoming requests.
     */
  requestParser: RequestParser;
  /**
     * Converts errors to a serializable format.
     */
  errorHandler: ErrorHandler;
  /**
     * Writes out the response of the operation.
     */
  responseWriter: ResponseWriter;
  /**
     * Handler to send the operation to.
     */
  operationHandler: OperationHttpHandler;
}

/**
 * Handles all request about DToU.
 * For quick prototying, everything as much as possible is covered in this file.
 *
 * Therefore, it does not use additional args in constructor; does not decouple operations to other classes.
 * Args reuse the same as a default LdpHandler (ParsingHttpHandler), as long as useful.
 *
 * === Old Content kept in case needed for reference. Does not reflect the function of this class. ===
 * Parses requests and sends the resulting {@link Operation} to the wrapped {@link OperationHttpHandler}.
 * Errors are caught and handled by the {@link ErrorHandler}.
 * In case the {@link OperationHttpHandler} returns a result it will be sent to the {@link ResponseWriter}.
 */
export class DtouRequestHandler extends HttpHandler {
  private readonly logger = getLoggerFor(this);

  private readonly credentialsExtractor: CredentialsExtractor;
  private readonly requestParser: RequestParser;
  private readonly errorHandler: ErrorHandler;
  private readonly responseWriter: ResponseWriter;
  private readonly operationHandler: OperationHttpHandler;

  public constructor(args: DtouHandlerArgs) {
    super();
    this.credentialsExtractor = args.credentialsExtractor;
    this.requestParser = args.requestParser;
    this.errorHandler = args.errorHandler;
    this.responseWriter = args.responseWriter;
    this.operationHandler = args.operationHandler;
    this.logger.info('DToU Handler Initiated');
  }

  public async canHandle(input: HttpHandlerInput): Promise<void> {
    const { request, response } = input;
    const operation = await this.requestParser.handleSafe(request);
    await this.operationHandler.canHandle({ operation, request, response });
  }

  public async handle({ request, response }: HttpHandlerInput): Promise<void> {
    this.logger.info("DToURequestHandler handling");
    let result: ResponseDescription;

    try {
      result = await this.handleRequest(request, response);
    } catch (error: unknown) {
      result = await this.handleError(error, request);
    }

    if (result) {
      await this.responseWriter.handleSafe({ response, result });
    }
  }

  /**
   * Interprets the request and passes the generated Operation object to the stored OperationHttpHandler.
   */
  protected async handleRequest(request: HttpRequest, response: HttpResponse):
  Promise<ResponseDescription> {
    const operation = await this.requestParser.handleSafe(request);
    const result = await this.operationHandler.handleSafe({ operation, request, response });
    this.logger.verbose(`Parsed ${operation.method} operation on ${operation.target.path}`);
    return result;
  }

  /**
   * Handles the error output correctly based on the preferences.
   */
  protected async handleError(error: unknown, request: HttpRequest): Promise<ResponseDescription> {
    assertError(error);
    const result = await this.errorHandler.handleSafe({ error, request });
    if (HttpError.isInstance(error) && result.metadata) {
      const quads = error.generateMetadata(result.metadata.identifier);
      result.metadata.addQuads(quads);
    }
    return result;
  }
}
