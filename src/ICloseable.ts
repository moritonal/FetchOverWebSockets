
export interface IClosable {
    close() : void;
    handshake() : void;
    process(msg : string) : Promise<void>;
}