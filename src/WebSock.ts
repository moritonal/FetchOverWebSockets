var ENABLE_COPYWITHIN = false;

var MAX_RQ_GROW_SIZE = 40 * 1024 * 1024;  // 40 MiB

var typedArrayToString = (function () {
    // This is only for PhantomJS, which doesn't like apply-ing
    // with Typed Arrays
    try {
        var arr = new Uint8Array([1, 2, 3]);
        String.fromCharCode.apply(null, arr);
        return function (a) { return String.fromCharCode.apply(null, a); };
    } catch (ex) {
        return function (a) {
            return String.fromCharCode.apply(
                null, Array.prototype.slice.call(a));
        };
    }
})();

export class WebSock {

    _websocket: WebSocket;
    _rQi : any;
    _rQlen: any;
    _rQbufferSize: any;
    _rQmax: any;
    receiveQueue: Uint8Array;
    _sQbufferSize: any;
    _sQlen: any;
    sendQueue: Uint8Array;
    _eventHandlers: any;

    constructor() {
        this._websocket = null;  // WebSocket ob
        this._rQi = 0;           // Receive queue index
        this._rQlen = 0;         // Next write position in the receive queue
        this._rQbufferSize = 1024 * 1024 * 4; // Receive queue buffer size (4 MiB)
        this._rQmax = this._rQbufferSize / 8;
        this.receiveQueue = null; // Receive q
        this._sQbufferSize = 1024 * 10;  // 10 KiB
        this._sQlen = 0;
        this.sendQueue = null;  // Send queue

        this._eventHandlers = {
            'message': function () { },
            'open': function () { },
            'close': function () { },
            'error': function () { }
        };
    }

    get_sQ() {
        return this.sendQueue;
    }

    get_rQ() {
        return this.receiveQueue;
    }

    get_rQi() {
        return this._rQi;
    }

    set_rQi(val) {
        this._rQi = val;
    }

    // Receive Queue
    rQlen() {
        return this._rQlen - this._rQi;
    }

    rQpeek8() {
        return this.receiveQueue[this._rQi];
    }

    rQshift8() {
        return this.receiveQueue[this._rQi++];
    }

    rQskip8() {
        this._rQi++;
    }

    rQskipBytes(num) {
        this._rQi += num;
    }

    // TODO(directxman12): test performance with these vs a DataView
    rQshift16() {
        return (this.receiveQueue[this._rQi++] << 8) +
            this.receiveQueue[this._rQi++];
    }

    rQshift32() {
        return (this.receiveQueue[this._rQi++] << 24) +
            (this.receiveQueue[this._rQi++] << 16) +
            (this.receiveQueue[this._rQi++] << 8) +
            this.receiveQueue[this._rQi++];
    }

    receiveQueueShift(len?) {
        if (typeof (len) === 'undefined') { len = this.rQlen(); }
        var arr = new Uint8Array(this.receiveQueue.buffer, this._rQi, len);
        this._rQi += len;
        return typedArrayToString(arr);
    }

    rQshiftBytes(len) {
        if (typeof (len) === 'undefined') { len = this.rQlen(); }
        this._rQi += len;
        return new Uint8Array(this.receiveQueue.buffer, this._rQi - len, len);
    }

    rQshiftTo(target, len) {
        if (len === undefined) { len = this.rQlen(); }
        // TODO: make this just use set with views when using a ArrayBuffer to store the rQ
        target.set(new Uint8Array(this.receiveQueue.buffer, this._rQi, len));
        this._rQi += len;
    }

    rQwhole() {
        return new Uint8Array(this.receiveQueue.buffer, 0, this._rQlen);
    }

    rQslice(start, end) {
        if (end) {
            return new Uint8Array(this.receiveQueue.buffer, this._rQi + start, end - start);
        } else {
            return new Uint8Array(this.receiveQueue.buffer, this._rQi + start, this._rQlen - this._rQi - start);
        }
    }

    // Send Queue
    flush() {

        if (this._sQlen > 0 && this._websocket.readyState === WebSocket.OPEN) {
            let msg = this._encode_message();
            this._websocket.send(msg);
            this._sQlen = 0;
        }
    }

    send(arr : Uint8Array) {

        this.sendQueue.set(arr, this._sQlen);
        this._sQlen += arr.length;
        this.flush();
    }

    send_string(str) {
        this.send(str.split('').map(function (chr) {
            return chr.charCodeAt(0);
        }));
    }

    // Event Handlers
    off(evt) {
        this._eventHandlers[evt] = function () { };
    }

    on(evt, handler) {
        this._eventHandlers[evt] = handler;
    }

    _allocate_buffers() {
        this.receiveQueue = new Uint8Array(this._rQbufferSize);
        this.sendQueue = new Uint8Array(this._sQbufferSize);
    }

    init() {
        this._allocate_buffers();
        this._rQi = 0;
        this._websocket = null;
    }

    open(uri, protocols) {

        var ws_schema = uri.match(/^([a-z]+):\/\//)[1];
        this.init();

        // IE, Edge and Firefox misbehave when protocols is
        // undefined, converting it to a string rather than
        // treating it as if it wasn't specified
        if (protocols) {
            this._websocket = new WebSocket(uri, protocols);
        } else {
            this._websocket = new WebSocket(uri);
        }

        this._websocket.binaryType = 'arraybuffer';

        this._websocket.onmessage = this._recv_message.bind(this);

        this._websocket.onopen = (function () {
            console.debug('>> WebSock.onopen');

            if (this._websocket.protocol) {
                console.info("Server choose sub-protocol: " + this._websocket.protocol);
            }

            this._eventHandlers.open();
            console.debug("<< WebSock.onopen");
        }).bind(this);

        this._websocket.onclose = (function (e) {
            console.debug(">> WebSock.onclose");
            this._eventHandlers.close(e);
            console.debug("<< WebSock.onclose");
        }).bind(this);

        this._websocket.onerror = (function (e) {
            console.debug(">> WebSock.onerror: " + e);
            this._eventHandlers.error(e);
            console.debug("<< WebSock.onerror: " + e);
        }).bind(this);
    }

    close() {
        if (this._websocket) {
            if ((this._websocket.readyState === WebSocket.OPEN) ||
                (this._websocket.readyState === WebSocket.CONNECTING)) {
                console.info("Closing WebSocket connection");
                this._websocket.close();
            }

            this._websocket.onmessage = function (e) { return; };
        }
    }

    // private methods
    _encode_message() {
        // Put in a binary arraybuffer
        // according to the spec, you can send ArrayBufferViews with the send method
        return new Uint8Array(this.sendQueue.buffer, 0, this._sQlen);
    }

    _expand_compact_rQ(min_fit?) {

        var resizeNeeded = min_fit || this._rQlen - this._rQi > this._rQbufferSize / 2;
        if (resizeNeeded) {
            if (!min_fit) {
                // just double the size if we need to do compaction
                this._rQbufferSize *= 2;
            } else {
                // otherwise, make sure we satisy rQlen - rQi + min_fit < rQbufferSize / 8
                this._rQbufferSize = (this._rQlen - this._rQi + min_fit) * 8;
            }
        }

        // we don't want to grow unboundedly
        if (this._rQbufferSize > MAX_RQ_GROW_SIZE) {
            this._rQbufferSize = MAX_RQ_GROW_SIZE;
            if (this._rQbufferSize - this._rQlen - this._rQi < min_fit) {
                throw "Receive Queue buffer exceeded " + MAX_RQ_GROW_SIZE + " bytes, and the new message could not fit";
            }
        }

        if (resizeNeeded) {
            var old_rQbuffer = this.receiveQueue.buffer;
            this._rQmax = this._rQbufferSize / 8;
            this.receiveQueue = new Uint8Array(this._rQbufferSize);
            this.receiveQueue.set(new Uint8Array(old_rQbuffer, this._rQi));
        } else {
            if (ENABLE_COPYWITHIN) {
                this.receiveQueue.copyWithin(0, this._rQi);
            } else {
                this.receiveQueue.set(new Uint8Array(this.receiveQueue.buffer, this._rQi));
            }
        }

        this._rQlen = this._rQlen - this._rQi;
        this._rQi = 0;
    }

    _decode_message(data) {
        // push arraybuffer values onto the end
        var u8 = new Uint8Array(data);
        if (u8.length > this._rQbufferSize - this._rQlen) {
            this._expand_compact_rQ(u8.length);
        }
        this.receiveQueue.set(u8, this._rQlen);
        this._rQlen += u8.length;
    }

    async _recv_message(e) {
        try {
            this._decode_message(e.data);
            if (this.rQlen() > 0) {

                await this._eventHandlers.message();

                // Compact the receive queue
                if (this._rQlen == this._rQi) {
                    this._rQlen = 0;
                    this._rQi = 0;
                } else if (this._rQlen > this._rQmax) {
                    this._expand_compact_rQ();
                }
            } else {
                console.debug("Ignoring empty message");
            }
        } catch (exc) {
            var exception_str = "";
            if (exc.name) {
                exception_str += "\n    name: " + exc.name + "\n";
                exception_str += "    message: " + exc.message + "\n";
            }

            if (typeof exc.description !== 'undefined') {
                exception_str += "    description: " + exc.description + "\n";
            }

            if (typeof exc.stack !== 'undefined') {
                exception_str += exc.stack;
            }

            if (exception_str.length > 0) {
                console.error("recv_message, caught exception: " + exception_str);
            } else {console.error
                console.error("recv_message, caught exception: " + exc);
            }

            if (typeof exc.name !== 'undefined') {
                this._eventHandlers.error(exc.name + ": " + exc.message);
            } else {
                this._eventHandlers.error(exc);
            }
        }
    }
}