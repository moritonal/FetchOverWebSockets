import * as forge from "node-forge"
import { WebSock } from "./WebSock"
import * as URI from "uri-js";
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

    async setupTlsStream(input: RequestInfo, init?: RequestInit) {

        // let WebSock = (await import("./WebSock")).WebSock;

        this.webSocket = new WebSock();

        let onData = null;

        // let forge = await import("node-forge");

        this.client = forge.tls.createConnection({

            caStore: this.certificateAuthorityStore,

            connected: async (connection) => {

                // let uri = (await import("uri-js")).parse(input as string).host;

                let postMessage = [
                    `${init.method} /oauth/token HTTP/1.1`,
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

                // clear data from the server is ready
                var data = connection.data.getBytes();

                await onData(data);

                // client.close();
            },
            closed: async () => {
                this.client = null;
                await onData(null);
            },
            error: async (connection, error) => {
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