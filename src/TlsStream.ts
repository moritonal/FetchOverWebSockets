import * as forge from "node-forge"
import * as URI from "uri-js";

import { WebSock } from "./WebSock"
import { IClosable } from "./ICloseable"

export class TlsStream {

    certificateAuthorityStore: Array<string> = null;

    constructor(certificateAuthorityStore: Array<string>) {
        this.certificateAuthorityStore = certificateAuthorityStore;
    }

    client: IClosable = null;
    webSocket = null;
    buffer: Array<string> = [];
    watch = null;

    async setupTlsStream(input: RequestInfo, init?: RequstInitWithUrl) {

        this.webSocket = new WebSock();

        let onData = null;

        this.client = forge.tls.createConnection({

            caStore: this.certificateAuthorityStore,

            connected: async (connection) => {

                let postMessage = [
                    `${init.method} ${init.url} HTTP/1.1`,

                    ...Object.keys(init.headers).map(i => `${i}: ${init.headers[i]}`),
                    `Host: ${URI.parse(input as string).host}`,
                    "Content-Type: application/javascript",
                    `Content-Length: ${init.body.toString().length}`,

                    "",
                    init.body,
                    "",
                    ""
                ];

                let httpPayload = postMessage.join("\r\n");

                connection.prepare(httpPayload);
            },
            tlsDataReady: (connection) => {

                var data = connection.tlsData.getBytes() as string;

                if (data.length == 0)
                    return;

                let byteBuffer = new Uint8Array(data.length);

                for (let i = 0; i < data.length; i++) {
                    byteBuffer[i] = data.charCodeAt(i);
                }

                this.webSocket.send(byteBuffer);
            },
            dataReady: async (connection) => {

                // Clear data from the server is ready
                var data = connection.data.getBytes();

                await onData(data);
            },
            closed: async () => {

                this.client = null;
                await onData(null);
            },
            error: async (connection : any, error : any) => {

                console.error('[TLS] Error', error);
                await onData(null);
            }
        });

        this.webSocket.on("open", () => {

            this.client.handshake();
        });

        this.webSocket.on("message", async () => {

            let msg: string = this.webSocket.receiveQueueShift();

            await this.client.process(msg);
        });

        this.buffer = new Array<string>();
        this.watch = null;

        onData = async (msg: string) => {

            if (msg !== null)
                this.buffer.push(msg);

            // Notify listeners
            if (this.watch !== null)
                await this.watch();
        };
    }

    openTlsStream = async function* (websocketEndpoint: string) {

        this.webSocket.open(websocketEndpoint, null);

        // While there is a client
        while (this.client != null) {

            // If there isn't data in the buffer already
            if (this.buffer.length == 0) {

                // Wait for new data by returning a promise to yield data in future
                yield await new Promise<string>((res, rej) => {

                    // Setup the callback for the TLS stream to notify
                    this.watch = async () => {

                        this.watch = null;

                        // Complete the promise for the yield to unblock the higher-level stream
                        if (this.buffer.length > 0)
                            res(this.buffer.pop() as string);
                    }
                });

            } else {

                // Otherwise instantly yield next chunk
                yield this.buffer.pop() as string;
            }
        }
    }
}