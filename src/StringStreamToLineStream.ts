export async function* StringStreamToLineStream<String, T2, T3>(stream : AsyncGenerator<string, T2, T3>) {
        
    for await (const datum of stream) {

        for (let line of datum.split("\r\n")) {
            yield line;
        }
    }
}