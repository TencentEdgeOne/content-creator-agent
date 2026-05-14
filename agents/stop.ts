export async function onRequest(context: any) {
    const { run_id: runId } = context;
    return new Response(
        JSON.stringify({ stopped: true, runId }),
        { status: 200, headers: { 'Content-Type': 'application/json; charset=UTF-8' } }
    );
}
