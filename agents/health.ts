export async function onRequest() {
    return new Response(
        JSON.stringify({ status: 'ok', timestamp: new Date().toISOString(), service: 'content-creator' }),
        { status: 200, headers: { 'Content-Type': 'application/json; charset=UTF-8' } }
    );
}
