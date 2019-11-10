import { IClosable } from "./ICloseable"
import { TlsStream } from "./TlsStream";
import { StringStreamToLineStream } from "./StringStreamToLineStream";

// Wildcard imports are supported by Parcel.js
import certs from "./certs/*.pem"

function isVoid(input: string | void): input is void {
    return (<string>input) == undefined;
}

export default class FetchOverWebSocket {

    websocketEndpoint: string = null;
    certificateAuthorityStore: Array<string> = null;

    constructor(websocketEndpoint: string) {

        this.websocketEndpoint = websocketEndpoint;
    }

    async buildCertificateAuthorityStore() {

        let caStore = [];

        for (let cert in certs) {

            caStore.push(await (await fetch(certs[cert])).text());
        }

        return caStore;
    }

    async fetch(input: RequestInfo, init?: RequestInit): Promise<Response> {

        if (this.certificateAuthorityStore == null) {

            // First time we should fetch the CA
            this.certificateAuthorityStore = await this.buildCertificateAuthorityStore();
        }

        // const TlsStream = (await import("./TlsStream")).TlsStream;

        // Sets up the TLS stream with the certificate authority
        let tlsStream = new TlsStream(this.certificateAuthorityStore);

        // Sets up the TLS stream with the fetch parameters
        await tlsStream.setupTlsStream(input, init);

        // This is a generator function yielding HTTP chunks
        let dataStream = tlsStream.openTlsStream(this.websocketEndpoint);

        // Pass the HTTP-chunk-stream into our handler
        let response = await this.handleResponse(tlsStream.client, dataStream);

        return response;
    }

    async handleResponse(client: IClosable, stream: AsyncGenerator<string, void, never>) : Promise<Response> {

        // Pipe the HTTP stream to a line stream
        let lineStream = StringStreamToLineStream(stream);

        let next = await lineStream.next();

        let header = next.value;

        if (isVoid(header))
            return;

        let [protocol, statusCode, statusText] = header.split(" ");

        let headers = [];
        let body = "";
        let mode = "headers";

        // Foreach line in the HTTP response
        for await (let line of lineStream) {
            if (line == "") {
                mode = "body";
                continue;
            }

            switch (mode) {
                case "headers":

                    // Parse a header
                    let [key, value] = line.split(":");
                    headers[key] = value.trim();

                    break;

                case "body":

                    // Parse the body
                    if (headers["Transfer-Encoding"] == "chunked") {

                        let size = line;

                        if (Number.parseInt(size, 16) == 0) {

                            // That's the end of the chunked-encoding, so close the underlying stream
                            client.close();

                            break;
                        }

                        let payload = await lineStream.next();

                        if (payload.done)
                            throw "Chunk length without payload received!";

                        body += payload.value;

                    } else {
                        throw `Unsupported encoding type: ${headers["Transfer-Encoding"]}`;
                    }

                    break;
            }
        }

        let response = new Response(body, {
            status: Number.parseInt(statusCode.trim()),
            statusText: statusText,
            headers: headers
        });

        return response;
    }
}