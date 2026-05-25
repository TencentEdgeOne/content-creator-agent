/**
 * Stop active run — aborts the running generation for this conversation.
 */
export async function onRequest(context: any) {
  const body = context.request?.body ?? {};
  const conversationId = body.conversation_id || context.conversation_id;

  if (!conversationId) {
    return new Response(
      JSON.stringify({ error: "Missing conversation_id" }),
      { status: 400, headers: { "Content-Type": "application/json; charset=UTF-8" } },
    );
  }

  const result = context.utils.abortActiveRun(conversationId);

  return new Response(
    JSON.stringify({
      status: result.aborted ? "stopped" : "no_active_run",
      conversationId,
      ...result,
    }),
    { status: 200, headers: { "Content-Type": "application/json; charset=UTF-8" } },
  );
}
